import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles, Film, AlertTriangle, RefreshCw } from 'lucide-react';
import { videoGeneration, type VgTimeline } from '@chayuan/api';
import { useVgComposer, scriptHashOf } from './store/vgComposer';
import { MediaPoolPanel } from './timeline/MediaPoolPanel';
import { PreviewPlayer } from './timeline/PreviewPlayer';
import { TransportBar } from './timeline/TransportBar';
import { TimelineTracks } from './timeline/TimelineTracks';
import { buildTimelineFromMaterials } from './timeline/buildTimeline';
import { appendClipFromMaterial, appendAudioClip, replaceClipSource, deleteAnyClip, type DraggedMaterial } from './timeline/timelineEdit';
import { TrackContextMenu, type TrackMenuCtx } from './timeline/TrackContextMenu';
import { playAudioTimeline } from './timeline/audioPreview';
import { totalDurationMs, rulerDurationMs, fitPxPerSec } from './timeline/timelineScale';
import { parseSrt, type SrtCue } from './timeline/srtParse';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { useTabsStore } from '../../store/tabs';

const POLL_MS = 2500;

export const VgTimelineEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const draft = useVgComposer((s) => s.timelineDraft);
  const patchDraft = useVgComposer((s) => s.patchDraft);

  const [pxPerSec, setPxPerSec] = React.useState(20);
  const [playheadMs, setPlayheadMs] = React.useState(0);
  const [seekMs, setSeekMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [proxyStale, setProxyStale] = React.useState(true);
  const [peaks, setPeaks] = React.useState<number[]>([]);
  const [cues, setCues] = React.useState<SrtCue[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const timeline = params.timeline ?? buildTimelineFromMaterials(params.video_materials ?? []);
  const curHash = scriptHashOf(params);

  // ── 草稿编排:进页面 / 脚本变 → 自动生成(stop_at=materials) ──
  React.useEffect(() => {
    const hasScript = (params.video_script || '').trim().length > 0;
    if (!hasScript) return;
    if (draft.state === 'generating') return;
    if (draft.state === 'ready' && draft.scriptHash === curHash) return; // 缓存命中
    let aborted = false;
    (async () => {
      patchDraft({ state: 'generating', scriptHash: curHash, error: undefined });
      try {
        const t = await videoGeneration.submitTask(params, { stop_at: 'subtitle' });
        if (aborted) return;
        patchDraft({ taskId: t.task_id });
      } catch (e) {
        if (!aborted) patchDraft({ state: 'failed', error: (e as Error).message });
      }
    })();
    return () => { aborted = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curHash]);

  // ── 轮询草稿 task 直到 complete ──
  useQuery({
    queryKey: ['vg.draft', draft.taskId],
    enabled: draft.state === 'generating' && !!draft.taskId,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const t = await videoGeneration.getTask(draft.taskId!);
      if (t.state === 'complete') {
        const res = t.result ?? {};
        const audioFull = String(res.audio_file ?? '');
        const subFull = String(res.subtitle_path ?? '');
        patchDraft({
          state: 'ready',
          audioFileName: audioFull ? audioFull.split(/[\\/]/).pop()! : null,
          subtitleFileName: subFull ? subFull.split(/[\\/]/).pop()! : null,
          materials: [], // P5a:素材手动拖入,草稿不再自动下素材
        });
      } else if (t.state === 'failed' || t.state === 'canceled') {
        patchDraft({ state: 'failed', error: t.error ?? '草稿生成失败' });
      }
      return t;
    },
  });

  // ── 草稿 ready → 拉波形 + 字幕,并据已选素材初始化 timeline ──
  React.useEffect(() => {
    if (draft.state !== 'ready' || !draft.taskId) return;
    (async () => {
      try {
        const pk = await videoGeneration.fetchAudioPeaks(draft.taskId!, 600);
        setPeaks(pk.peaks);
        patchDraft({ audioDurationMs: pk.duration_ms });
      } catch { setPeaks([]); }
      if (draft.subtitleFileName) {
        try {
          const { blob } = await videoGeneration.downloadTaskFile(draft.taskId!, draft.subtitleFileName);
          setCues(parseSrt(await blob.text()));
        } catch { setCues([]); }
      }
      if (!params.timeline) patchParams({ timeline: buildTimelineFromMaterials(params.video_materials ?? []) });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.state, draft.taskId]);

  const contentMs = totalDurationMs(timeline, draft.audioDurationMs); // 实际成片时长(传输栏显示)
  const durationMs = rulerDurationMs(contentMs); // 标尺/画布展示时长(向后留富余,可放更多元素)

  // 容器宽变化时 fit 一次(内容时长首次 > 0;按内容铺满,富余部分横向滚)
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (containerRef.current && contentMs > 0) {
      setPxPerSec(fitPxPerSec(contentMs, containerRef.current.clientWidth - 80));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentMs > 0]);

  const onTimelineChange = (t: VgTimeline) => { patchParams({ timeline: t }); setProxyStale(true); };
  // 缩略图按 clip 的 source 解析:material_id → 素材缩略图;url(http)→ 暂无。
  const videoClips = (timeline.tracks ?? []).find((t) => t.kind === 'video')?.clips ?? [];
  const thumbUrlOf = (i: number) => {
    const src = videoClips[i]?.source;
    return src?.material_id ? videoGeneration.materialThumbUrl(src.material_id) : null;
  };
  const onDropMaterial = (m: DraggedMaterial) => {
    if (m.kind === 'audio') return; // 音频走音频轨
    onTimelineChange(appendClipFromMaterial(timeline, m));
  };
  const onDropAudio = (m: DraggedMaterial) => { onTimelineChange(appendAudioClip(timeline, m)); };
  const [replacingClipId, setReplacingClipId] = React.useState<string | null>(null);
  const onReplaceClip = (clipId: string) => setReplacingClipId(clipId);

  // ── 右键菜单 / 试听 / 上传 / 库添加 / 删除 ──
  const [menuCtx, setMenuCtx] = React.useState<TrackMenuCtx | null>(null);
  const [libPickTrack, setLibPickTrack] = React.useState<'video' | 'audio' | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadTrackRef = React.useRef<'video' | 'audio'>('video');
  const previewStopRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => { previewStopRef.current?.(); }, []);

  const mimeKind = (mime?: string): 'video' | 'image' | 'audio' =>
    (mime || '').startsWith('image') ? 'image' : (mime || '').startsWith('audio') ? 'audio' : 'video';
  const addMaterialToTrack = (track: 'video' | 'audio', m: { material_id: string; mime?: string; duration_ms?: number }) => {
    const dm: DraggedMaterial = { materialId: m.material_id, kind: track === 'audio' ? 'audio' : mimeKind(m.mime), durationMs: m.duration_ms || undefined };
    onTimelineChange(track === 'audio' ? appendAudioClip(timeline, dm) : appendClipFromMaterial(timeline, dm));
  };
  const onLaneContextMenu = (e: React.MouseEvent, track: 'video' | 'audio', clipId?: string) =>
    setMenuCtx({ x: e.clientX, y: e.clientY, track, clipId });
  const doUploadLocal = (track: 'video' | 'audio') => { uploadTrackRef.current = track; fileInputRef.current?.click(); };
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const m = await videoGeneration.uploadMaterial({ file });
      addMaterialToTrack(uploadTrackRef.current, m);
    } catch (err) { reportError(err as Error, '上传失败'); }
  };
  const stopPreview = () => { previewStopRef.current?.(); previewStopRef.current = null; };
  const doPreviewNarration = () => {
    if (previewStopRef.current) return stopPreview();
    if (!draft.taskId || !draft.audioFileName) { reportError(new Error('旁白尚未生成')); return; }
    previewStopRef.current = playAudioTimeline(
      [{ url: videoGeneration.taskFileUrl(draft.taskId, draft.audioFileName), startMs: 0 }],
      () => { previewStopRef.current = null; });
  };
  const doPreviewAudioTrack = () => {
    if (previewStopRef.current) return stopPreview();
    const clips = (timeline.tracks ?? []).find((t) => t.kind === 'audio')?.clips ?? [];
    const items = clips.map((c) => ({
      url: c.source.material_id ? videoGeneration.materialFileUrl(c.source.material_id) : (c.source.url ?? ''),
      startMs: c.track_start_ms,
    })).filter((it) => it.url);
    if (items.length === 0) { reportError(new Error('音频轨为空')); return; }
    previewStopRef.current = playAudioTimeline(items, () => { previewStopRef.current = null; });
  };

  // ── 提交:finalize 草稿(复用 audio/subtitle,只 compose) ──
  const onSubmit = async () => {
    if (draft.state !== 'ready' || !draft.taskId) { reportError(new Error('草稿尚未就绪,稍候再试')); return; }
    setSubmitting(true);
    try {
      await videoGeneration.finalizeDraft(draft.taskId, timeline, cues.length ? cues : undefined);
      notifySuccess('已提交合成', '前往「我的视频」看进度');
      openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
      void navigate({ to: '/video-generation/library' as never });
    } catch (e) { reportError(e as Error, '提交失败'); }
    finally { setSubmitting(false); }
  };

  const bgmName = params.bgm_type === 'random' ? '随机背景音乐' : (params.bgm_file || null);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col">
      {/* 上半:素材库 + 预览 */}
      <div className="flex min-h-0 flex-1">
        <MediaPoolPanel />
        <div className="min-h-0 flex-1 p-3">
          <PreviewPlayer
            timeline={timeline} aspect={params.video_aspect}
            seekMs={seekMs} playing={playing} stale={proxyStale}
            onTimeMs={(ms) => setPlayheadMs(ms)}
            onPlayingChange={setPlaying}
            onFreshGenerated={() => setProxyStale(false)}
          />
        </div>
      </div>
      {/* transport */}
      <TransportBar playing={playing} currentMs={playheadMs} durationMs={contentMs} pxPerSec={pxPerSec}
        onPlayPause={() => setPlaying((v) => !v)} onZoom={setPxPerSec} />
      {/* 草稿状态条 */}
      {draft.state === 'generating' && (
        <div className="flex items-center gap-2 bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在预生成旁白 / 字幕 / 素材…
        </div>
      )}
      {draft.state === 'failed' && (
        <div className="flex items-center gap-2 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5" /> 草稿生成失败:{draft.error}
          <button type="button" onClick={() => useVgComposer.getState().resetDraft()}
            className="ml-2 inline-flex items-center gap-1 rounded border border-rose-300 px-2 py-0.5 hover:bg-rose-100">
            <RefreshCw className="h-3 w-3" /> 重试
          </button>
        </div>
      )}
      {/* 下半:全宽多轨时间轴 */}
      <div className="border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">
            <Film className="h-4 w-4" /> 时间轴
          </h2>
          <button type="button" onClick={() => void onSubmit()} disabled={submitting || draft.state !== 'ready'}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交合成
          </button>
        </div>
        <TimelineTracks
          timeline={timeline} durationMs={durationMs} pxPerSec={pxPerSec} playheadMs={playheadMs}
          peaks={peaks} peaksLoading={draft.state === 'generating'} cues={cues} bgmName={bgmName}
          thumbUrlOf={thumbUrlOf}
          onDropAudio={onDropAudio}
          onCuesChange={setCues}
          onReplaceClip={onReplaceClip}
          onDropMaterial={onDropMaterial}
          onLaneContextMenu={onLaneContextMenu}
          onPreviewNarration={doPreviewNarration}
          onPreviewAudio={doPreviewAudioTrack}
          onSeekMs={(ms) => { setSeekMs(ms); setPlayheadMs(ms); }}
          onTimelineChange={onTimelineChange}
        />
      </div>
      {/* 隐藏文件输入(右键「从本地上传」) */}
      <input ref={fileInputRef} type="file" accept="video/*,image/*,audio/*" className="hidden" onChange={(e) => void onFilePicked(e)} />
      {/* 轨道右键菜单 */}
      {menuCtx && (
        <TrackContextMenu ctx={menuCtx}
          onUploadLocal={() => doUploadLocal(menuCtx.track)}
          onAddFromLibrary={() => setLibPickTrack(menuCtx.track)}
          onPreview={() => (menuCtx.track === 'audio' ? doPreviewAudioTrack() : doPreviewNarration())}
          onDeleteClip={(id) => onTimelineChange(deleteAnyClip(timeline, id))}
          onClose={() => setMenuCtx(null)} />
      )}
      {/* 替换素材弹层 */}
      {replacingClipId && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={() => setReplacingClipId(null)}>
          <div className="max-h-[80vh] w-[min(720px,92vw)] overflow-y-auto cy-hide-scrollbar rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">选择替换素材(我的素材库)</p>
            <ReplacePicker onPick={(m) => {
              onTimelineChange(replaceClipSource(timeline, replacingClipId, { material_id: m.material_id }));
              setReplacingClipId(null);
            }} />
          </div>
        </div>
      )}
      {/* 从素材库添加到轨道 */}
      {libPickTrack && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={() => setLibPickTrack(null)}>
          <div className="max-h-[80vh] w-[min(720px,92vw)] overflow-y-auto cy-hide-scrollbar rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">从素材库添加到{libPickTrack === 'audio' ? '音频' : '视频'}轨</p>
            <ReplacePicker onPick={(m) => { addMaterialToTrack(libPickTrack, m); setLibPickTrack(null); }} />
          </div>
        </div>
      )}
    </div>
  );
};

const ReplacePicker: React.FC<{ onPick: (m: { material_id: string; mime?: string; duration_ms?: number; name: string }) => void }> = ({ onPick }) => {
  const q = useQuery({ queryKey: ['vg.materials.replace'], queryFn: () => videoGeneration.listMaterials({ page: 1, page_size: 60 }) });
  const items = q.data?.items ?? [];
  if (q.isLoading) return <p className="text-xs text-[var(--cy-text-tertiary)]">加载中…</p>;
  if (items.length === 0) return <p className="text-xs text-[var(--cy-text-tertiary)]">素材库为空,先到「素材库」添加</p>;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((m) => (
        <li key={m.material_id}>
          <button type="button" onClick={() => onPick(m)}
            className="block w-full overflow-hidden rounded-lg border border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-500)]">
            <img src={videoGeneration.materialThumbUrl(m.material_id)} alt={m.name} className="aspect-video w-full object-cover" loading="lazy" />
            <span className="block truncate px-1 py-0.5 text-[10px] text-[var(--cy-text-secondary)]">{m.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

export default VgTimelineEditorPage;

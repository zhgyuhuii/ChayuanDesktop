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
import { appendClipFromMaterial, type DraggedMaterial } from './timeline/timelineEdit';
import { totalDurationMs, fitPxPerSec } from './timeline/timelineScale';
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

  const durationMs = totalDurationMs(timeline, draft.audioDurationMs);

  // 容器宽变化时 fit 一次(durationMs 首次 > 0)
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (containerRef.current && durationMs > 0) {
      setPxPerSec(fitPxPerSec(durationMs, containerRef.current.clientWidth - 80));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs > 0]);

  const onTimelineChange = (t: VgTimeline) => { patchParams({ timeline: t }); setProxyStale(true); };
  // 缩略图按 clip 的 source 解析:material_id → 素材缩略图;url(http)→ 暂无。
  const videoClips = (timeline.tracks ?? []).find((t) => t.kind === 'video')?.clips ?? [];
  const thumbUrlOf = (i: number) => {
    const src = videoClips[i]?.source;
    return src?.material_id ? videoGeneration.materialThumbUrl(src.material_id) : null;
  };
  const onDropMaterial = (m: DraggedMaterial) => {
    onTimelineChange(appendClipFromMaterial(timeline, m));
  };

  // ── 提交:finalize 草稿(复用 audio/subtitle,只 compose) ──
  const onSubmit = async () => {
    if (draft.state !== 'ready' || !draft.taskId) { reportError(new Error('草稿尚未就绪,稍候再试')); return; }
    setSubmitting(true);
    try {
      await videoGeneration.finalizeDraft(draft.taskId, timeline);
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
      <TransportBar playing={playing} currentMs={playheadMs} durationMs={durationMs} pxPerSec={pxPerSec}
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
          onDropMaterial={onDropMaterial}
          onSeekMs={(ms) => { setSeekMs(ms); setPlayheadMs(ms); }}
          onTimelineChange={onTimelineChange}
        />
      </div>
    </div>
  );
};

export default VgTimelineEditorPage;

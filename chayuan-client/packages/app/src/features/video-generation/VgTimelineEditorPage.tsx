import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles, Film, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Eye, EyeOff, FileText, Volume2, Type, Music, Captions } from 'lucide-react';
import { VgAspectPicker } from './VgAspectPicker';
import { videoGeneration, type VgTimeline } from '@chayuan/api';
import { useVgComposer, scriptHashOf } from './store/vgComposer';
import { MediaPoolPanel } from './timeline/MediaPoolPanel';
import { PreviewPlayer } from './timeline/PreviewPlayer';
import { TransportBar } from './timeline/TransportBar';
import { TimelineTracks } from './timeline/TimelineTracks';
import { buildTimelineFromMaterials } from './timeline/buildTimeline';
import { appendClipFromMaterial, appendAudioClip, replaceClipSource, deleteAnyClip, roundTimeline, setClipTransition, type DraggedMaterial } from './timeline/timelineEdit';
import { TRANSITIONS } from './timeline/transitions';
import { addTrack, removeTrack, setClipTransform, reorderVideoTrack } from './timeline/trackOps';
import { TrackContextMenu, type TrackMenuCtx } from './timeline/TrackContextMenu';
import { ScriptGenDialog } from './timeline/ScriptGenDialog';
import { ScriptEditorDialog } from './timeline/ScriptEditorDialog';
import { VgSpeechSettings } from './VgAudioPopover';
import { VgSubtitleSettings } from './VgSubtitlePopover';
import { BgmSection } from './sections/BgmSection';
import { SubtitleBulkEditor } from './timeline/SubtitleBulkEditor';
import { rebuildCuesFromLines } from './timeline/subtitleEdit';
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
  const [seekNonce, setSeekNonce] = React.useState(0); // 播放中拖播放头 → 防抖后重启引擎从新位置续播
  const seekDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<'live' | 'proxy'>('live');
  const [proxyStale, setProxyStale] = React.useState(true);
  const [peaks, setPeaks] = React.useState<number[]>([]);
  const [cues, setCues] = React.useState<SrtCue[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [poolW, setPoolW] = React.useState<number>(() => {
    const v = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('cy.vg.mediapool.w')) : 0;
    return v >= 160 && v <= 560 ? v : 288;
  });
  const poolWRef = React.useRef(poolW);
  React.useEffect(() => { poolWRef.current = poolW; }, [poolW]);
  // 折叠态 + 时间轴高度(可拖)
  const [previewCollapsed, setPreviewCollapsed] = React.useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = React.useState(false);
  const [timelineH, setTimelineH] = React.useState<number>(() => {
    const v = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('cy.vg.timeline.h')) : 0;
    return v >= 120 && v <= 600 ? v : 280;
  });
  const timelineHRef = React.useRef(timelineH);
  React.useEffect(() => { timelineHRef.current = timelineH; }, [timelineH]);

  const timeline = params.timeline ?? buildTimelineFromMaterials(params.video_materials ?? []);
  const curHash = scriptHashOf(params);
  // 可生成:有手写脚本,或 ai 模式 + 有主题(页内「生成脚本」表单填的)
  const canGen = (params.video_script || '').trim().length > 0
    || (params.script_source === 'ai' && (params.video_subject || '').trim().length > 0);
  const [scriptGenOpen, setScriptGenOpen] = React.useState(false);
  const [scriptEditOpen, setScriptEditOpen] = React.useState(false);
  // #18/#19:编辑器内联设置面板(复用会话同款 语音/字幕/背景音乐 section)
  const [settingsPanel, setSettingsPanel] = React.useState<'speech' | 'subtitle' | 'bgm' | null>(null);
  const [subtitleEditorOpen, setSubtitleEditorOpen] = React.useState(false);
  // 提交一次草稿生成(stop_at=subtitle:只旁白+字幕,不下素材)。
  // override 显式传参 → 避开 patchParams 异步闭包旧值,并保证「点了就生成」不靠 hash 变化。
  const runDraftGen = React.useCallback(async (override?: typeof params) => {
    const base = override ?? params;
    const submitP = { ...base, timeline: base.timeline ? roundTimeline(base.timeline) : base.timeline };
    patchDraft({ state: 'generating', scriptHash: scriptHashOf(submitP), error: undefined, taskId: null });
    try {
      const t = await videoGeneration.submitTask(submitP, { stop_at: 'subtitle' });
      patchDraft({ taskId: t.task_id });
    } catch (e) {
      patchDraft({ state: 'failed', error: (e as Error).message });
    }
  }, [params, patchDraft]);
  const startDraftGen = React.useCallback(() => runDraftGen(), [runDraftGen]);

  const submitScriptGen = (v: { subject: string; model: string | null; paragraph: number; language: string }) => {
    const next = { ...params, video_subject: v.subject, model: v.model ?? undefined, paragraph_number: v.paragraph, video_language: v.language, script_source: 'ai' as const, video_script: '' };
    patchParams({ video_subject: v.subject, model: v.model ?? undefined, paragraph_number: v.paragraph, video_language: v.language, script_source: 'ai', video_script: '' });
    setScriptGenOpen(false);
    void runDraftGen(next); // 点「生成」立即重生成,不依赖 hash 变化
  };

  // 手动脚本(#15):保存到 params.video_script(script_source=manual)
  const onSaveScript = (script: string) => patchParams({ video_script: script, script_source: 'manual', video_subject: '' });
  // 合成语音:按当前音频设置生成旁白+字幕
  const onSynthesizeScript = async (script: string) => {
    patchParams({ video_script: script, script_source: 'manual', video_subject: '' });
    await runDraftGen({ ...params, video_script: script, script_source: 'manual', video_subject: '' });
  };

  // ── 进页面 / 脚本变 → 自动生成旁白+字幕 ──
  // 仅当 hash 命中(当前脚本已 ready 或正在生成)才跳过;否则(idle/failed/旧 hash 卡 generating)重发。
  React.useEffect(() => {
    if (!canGen) return;
    if (draft.scriptHash === curHash && (draft.state === 'ready' || draft.state === 'generating')) return;
    void startDraftGen();
    // 依赖 canGen:去编辑合成进入时 video_script 可能晚一拍才到,canGen false→true 时补触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curHash, canGen]);

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
          // 旁白时长直接取任务结果(可靠),不依赖 audio-peaks;contentMs/旁白块据此显示
          audioDurationMs: Number(res.audio_duration_ms) || 0,
          script: String(res.script ?? ''), // 服务端生成的脚本,供「编辑脚本」回显
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
        if (pk.duration_ms > 0) patchDraft({ audioDurationMs: pk.duration_ms }); // 不用 0 覆盖结果里的可靠值
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

  // #17 实时播放引擎:实时画布模式下,播放键用 rAF 推进播放头 + 同步起播旁白/音频轨
  // (无需先「精确预览」proxy)。proxy 模式由 proxy <video> 自己驱动,这里不跑。
  const playheadRef = React.useRef(playheadMs);
  React.useEffect(() => { playheadRef.current = playheadMs; }, [playheadMs]);
  React.useEffect(() => {
    if (!playing || previewMode !== 'live') return;
    let start = playheadRef.current;
    if (start >= contentMs - 20) start = 0; // 到末尾再按播放 = 从头
    playheadRef.current = start; // 同步,避免首帧读到旧值
    setPlayheadMs(start);
    // 音频:旁白(从 0)+ 各音频轨 clip(按 track_start)+ 背景音乐(从 0,循环,bgm_volume)
    const items: { url: string; startMs: number; volume?: number; loop?: boolean }[] = [];
    if (draft.taskId && draft.audioFileName) items.push({ url: videoGeneration.taskFileUrl(draft.taskId, draft.audioFileName), startMs: 0 });
    for (const tr of (timeline.tracks ?? [])) {
      if (tr.kind !== 'audio') continue;
      for (const c of (tr.clips ?? [])) {
        const url = c.source.material_id ? videoGeneration.materialFileUrl(c.source.material_id) : (c.source.url ?? '');
        if (url) items.push({ url, startMs: c.track_start_ms });
      }
    }
    if (params.bgm_type === 'file' && params.bgm_file) {
      const base = params.bgm_file.split(/[\\/]/).pop() || '';
      if (base) items.push({ url: videoGeneration.bgmFileUrl(base), startMs: 0, volume: params.bgm_volume, loop: true });
    }
    const stopAudio = items.length ? playAudioTimeline(items, undefined, start) : null;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = now - last; last = now;
      const np = playheadRef.current + dt;
      if (np >= contentMs) { setPlayheadMs(contentMs); setPlaying(false); return; }
      setPlayheadMs(np);
      raf = requestAnimationFrame(tick);
    });
    return () => { cancelAnimationFrame(raf); stopAudio?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, previewMode, seekNonce]);

  // 容器宽变化时 fit 一次(内容时长首次 > 0;按内容铺满,富余部分横向滚)
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (containerRef.current && contentMs > 0) {
      setPxPerSec(fitPxPerSec(contentMs, containerRef.current.clientWidth - 80));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentMs > 0]);

  // 画幅改变 → 预览过期(重新生成才按新画幅)
  React.useEffect(() => { setProxyStale(true); }, [params.video_aspect, params.video_width, params.video_height]);

  // 写入前取整(防小数 out_ms/track_start_ms 触发后端 422,见 roundTimeline)
  const onTimelineChange = (t: VgTimeline) => { patchParams({ timeline: roundTimeline(t) }); setProxyStale(true); };
  // 缩略图按 clip 的 source 解析:material_id → 素材缩略图;url(http)→ 暂无。
  const videoClips = (timeline.tracks ?? []).find((t) => t.kind === 'video')?.clips ?? [];
  const thumbUrlOf = (i: number) => {
    const src = videoClips[i]?.source;
    return src?.material_id ? videoGeneration.materialThumbUrl(src.material_id) : null;
  };
  const onDropMaterial = (m: DraggedMaterial, trackId?: string, atIndex?: number) => {
    if (m.kind === 'audio') return; // 音频走音频轨
    onTimelineChange(appendClipFromMaterial(timeline, m, atIndex, trackId, contentMs));
  };
  const onDropAudio = (m: DraggedMaterial, trackId?: string) => { onTimelineChange(appendAudioClip(timeline, m, undefined, trackId)); };
  const [selectedTrackId, setSelectedTrackId] = React.useState<string | null>(null);
  // #10:跨轨选中 clip + Delete/Backspace 删除(焦点在输入框时不拦)
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedClipId) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      onTimelineChange(deleteAnyClip(timeline, selectedClipId));
      setSelectedClipId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId, timeline]);
  const onSetTransform = (clipId: string, tf: { x?: number; y?: number; scale?: number }) => onTimelineChange(setClipTransform(timeline, clipId, tf));
  // #26 片段间转场菜单
  const [txMenu, setTxMenu] = React.useState<{ x: number; y: number; clipId: string } | null>(null);
  React.useEffect(() => {
    if (!txMenu) return;
    const close = () => setTxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTxMenu(null); };
    const t = setTimeout(() => { window.addEventListener('click', close); window.addEventListener('keydown', onKey); }, 0);
    return () => { clearTimeout(t); window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [txMenu]);
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
    onTimelineChange(track === 'audio' ? appendAudioClip(timeline, dm) : appendClipFromMaterial(timeline, dm, undefined, undefined, contentMs));
  };
  const onLaneContextMenu = (e: React.MouseEvent, track: 'video' | 'audio' | 'subtitle' | 'narration', clipId?: string, trackId?: string, removable?: boolean) =>
    setMenuCtx({ x: e.clientX, y: e.clientY, track, clipId, trackId, removable });
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
  const doDownloadNarration = async () => {
    if (!draft.taskId || !draft.audioFileName) { reportError(new Error('旁白尚未生成')); return; }
    try {
      const { blob } = await videoGeneration.downloadTaskFile(draft.taskId, draft.audioFileName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = draft.audioFileName || 'narration.wav';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { reportError(e as Error, '旁白下载失败'); }
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
      await videoGeneration.finalizeDraft(draft.taskId, roundTimeline(timeline), cues.length ? cues : undefined);
      notifySuccess('已提交合成', '前往「我的视频」看进度');
      openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
      void navigate({ to: '/video-generation/library' as never });
    } catch (e) { reportError(e as Error, '提交失败'); }
    finally { setSubmitting(false); }
  };

  // 旁白音频块名称 = 主题名(video_subject);手动脚本时取脚本首句;都空则「旁白」
  const narrationName = ((params.video_subject || '').trim()
    || (params.video_script || '').trim().split(/[\n。.!?！？]/)[0] || '旁白').slice(0, 20) || '旁白';
  // 音乐轨只显名称(basename),不显完整路径;file 模式给试听 URL(后端按 basename 解析)
  const bgmBase = params.bgm_file ? (params.bgm_file.split(/[\\/]/).pop() || '') : '';
  const bgmName = params.bgm_type === 'random' ? '随机背景音乐' : (bgmBase || null);
  const bgmUrl = params.bgm_type === 'file' && bgmBase ? videoGeneration.bgmFileUrl(bgmBase) : undefined;

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col">
      {/* 上半:素材库 + 可拖分隔条 + 预览(始终显示;折叠时间轴时占满) */}
      {(
        <div className="flex min-h-0 flex-1">
          <MediaPoolPanel width={poolW} fill={previewCollapsed} />
          {!previewCollapsed && (
            <div
              title="拖动调整素材库宽度"
              onPointerDown={(e) => {
                e.preventDefault();
                const startX = e.clientX; const startW = poolWRef.current;
                const move = (ev: PointerEvent) => {
                  const w = Math.max(160, Math.min(560, startW + (ev.clientX - startX)));
                  poolWRef.current = w; setPoolW(w);
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  try { localStorage.setItem('cy.vg.mediapool.w', String(poolWRef.current)); } catch { /* noop */ }
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
              className="w-1 shrink-0 cursor-ew-resize bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]"
            />
          )}
          {previewCollapsed ? (
            <button type="button" onClick={() => setPreviewCollapsed(false)} title="展开预览"
              className="flex w-8 shrink-0 flex-col items-center gap-1 border-l border-[var(--cy-border-subtle)] py-2 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
              <Eye className="h-3.5 w-3.5" />
              <span className="[writing-mode:vertical-rl]">展开预览</span>
            </button>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* 预览头:画幅条 + 折叠 */}
              <div className="flex items-center gap-2 px-3 pt-2">
                <VgAspectPicker compact />
                <button type="button" onClick={() => setPreviewCollapsed((v) => !v)}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                  <EyeOff className="h-3 w-3" /> 折叠预览
                </button>
              </div>
              <div className="min-h-0 flex-1 p-3">
                <PreviewPlayer
                  timeline={timeline} aspect={params.video_aspect}
                  width={params.video_width} height={params.video_height}
                  playheadMs={playheadMs} seekMs={seekMs} playing={playing} stale={proxyStale}
                  onTimeMs={(ms) => setPlayheadMs(ms)}
                  onPlayingChange={setPlaying}
                  onFreshGenerated={() => setProxyStale(false)}
                  onTransform={onSetTransform}
                  onModeChange={setPreviewMode}
                  cues={cues}
                  taskId={draft.taskId} audioFileName={draft.audioFileName}
                  composeParams={{ ...params, timeline }}
                />
              </div>
            </div>
          )}
        </div>
      )}
      {/* 上下可拖分隔条(调时间轴高度) */}
      {!timelineCollapsed && (
        <div
          title="拖动调整时间轴高度"
          onPointerDown={(e) => {
            e.preventDefault();
            const startY = e.clientY; const startH = timelineHRef.current;
            const move = (ev: PointerEvent) => {
              const h = Math.max(120, Math.min(600, startH - (ev.clientY - startY)));
              timelineHRef.current = h; setTimelineH(h);
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              try { localStorage.setItem('cy.vg.timeline.h', String(timelineHRef.current)); } catch { /* noop */ }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          className="h-1 shrink-0 cursor-ns-resize bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]"
        />
      )}
      {/* transport */}
      <TransportBar playing={playing} currentMs={playheadMs} durationMs={contentMs} pxPerSec={pxPerSec}
        onPlayPause={() => setPlaying((v) => !v)} onZoom={setPxPerSec} />
      {/* 草稿状态条 */}
      {!canGen && (
        <div className="flex items-center gap-2 bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-tertiary)]">
          还没有脚本 —— 点「编辑脚本」手动输入/粘贴,或「生成脚本」用 AI 生成;之后按语音配置合成旁白。
          <button type="button" onClick={() => setScriptEditOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-strong)] px-2 py-0.5 text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
            <FileText className="h-3 w-3" /> 编辑脚本
          </button>
        </div>
      )}
      {canGen && draft.state === 'idle' && (
        <div className="flex items-center gap-2 bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-secondary)]">
          旁白未生成。
          <button type="button" onClick={() => void startDraftGen()}
            className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-strong)] px-2 py-0.5 hover:bg-[var(--cy-surface-2)]">
            <RefreshCw className="h-3 w-3" /> 生成旁白
          </button>
        </div>
      )}
      {draft.state === 'generating' && (
        <div className="flex items-center gap-2 bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在按语音配置生成旁白 + 字幕…
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
      {/* 下半:全宽多轨时间轴(可折叠 + 拖高) */}
      <div className="flex min-h-0 flex-col border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3"
        style={timelineCollapsed ? undefined : { height: timelineH }}>
        {/* #18/#19 设置面板:在工具栏行**上方**展开(语音/字幕/背景音乐,复用会话组件) */}
        {!timelineCollapsed && settingsPanel && (
          <div className="mb-2 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-2">
            {settingsPanel === 'speech' ? <VgSpeechSettings />
              : settingsPanel === 'subtitle' ? <VgSubtitleSettings />
              : <BgmSection />}
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">
            <Film className="h-4 w-4" /> 时间轴
          </h2>
          <button type="button" onClick={() => setTimelineCollapsed((v) => !v)} title={timelineCollapsed ? '展开时间轴' : '折叠时间轴'}
            className="inline-flex h-7 items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
            {timelineCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} {timelineCollapsed ? '展开' : '折叠'}
          </button>
          <button type="button" onClick={() => setScriptGenOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
            <Sparkles className="h-3.5 w-3.5" /> 生成脚本
          </button>
          <button type="button" onClick={() => setScriptEditOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
            <FileText className="h-3.5 w-3.5" /> 编辑脚本
          </button>
          <button type="button" onClick={() => setSubtitleEditorOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
            <Captions className="h-3.5 w-3.5" /> 编辑字幕
          </button>
          {/* 语音 / 字幕 / 背景音乐 设置 chip —— 与上面按钮同排,点击向上展开面板 */}
          <span className="mx-0.5 h-5 w-px bg-[var(--cy-border-subtle)]" />
          {([['speech', '语音', Volume2], ['subtitle', '字幕', Type], ['bgm', '背景音乐', Music]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setSettingsPanel((c) => (c === k ? null : k))}
              className={'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs transition-colors ' +
                (settingsPanel === k
                  ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')}>
              <Icon className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" /> {label}
              <ChevronDown className={'h-3 w-3 transition-transform ' + (settingsPanel === k ? 'rotate-180' : '')} />
            </button>
          ))}
          <button type="button" onClick={() => void onSubmit()} disabled={submitting || draft.state !== 'ready'}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交合成
          </button>
        </div>
        {!timelineCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar">
        <TimelineTracks
          timeline={timeline} durationMs={durationMs} pxPerSec={pxPerSec} playheadMs={playheadMs}
          peaks={peaks} peaksLoading={draft.state === 'generating'} cues={cues} bgmName={bgmName} bgmUrl={bgmUrl}
          thumbUrlOf={thumbUrlOf}
          onDropAudio={onDropAudio}
          onCuesChange={setCues}
          onReplaceClip={onReplaceClip}
          onDropMaterial={onDropMaterial}
          onLaneContextMenu={onLaneContextMenu}
          selectedTrackId={selectedTrackId}
          onSelectTrack={setSelectedTrackId}
          onReorderVideoTrack={(tid, dir) => onTimelineChange(reorderVideoTrack(timeline, tid, dir))}
          selectedClipId={selectedClipId}
          onSelectClip={setSelectedClipId}
          narrationName={narrationName}
          narrationDurationMs={draft.audioDurationMs || (peaks.length ? contentMs : 0)}
          onTransitionMenu={(e, clipId) => setTxMenu({ x: e.clientX, y: e.clientY, clipId })}
          onSeekMs={(ms) => {
            setSeekMs(ms); setPlayheadMs(ms); playheadRef.current = ms;
            if (playing) { // 停止拖动 120ms 后从新位置续播(旁白/音频/画面)
              if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
              seekDebounceRef.current = setTimeout(() => setSeekNonce((n) => n + 1), 120);
            }
          }}
          onTimelineChange={onTimelineChange}
        />
        </div>
        )}
      </div>
      {/* 隐藏文件输入(右键「从本地上传」) */}
      <input ref={fileInputRef} type="file" accept="video/*,image/*,audio/*" className="hidden" onChange={(e) => void onFilePicked(e)} />
      {/* 轨道右键菜单 */}
      {menuCtx && (
        <TrackContextMenu ctx={menuCtx}
          onUploadLocal={() => doUploadLocal(menuCtx.track === 'audio' ? 'audio' : 'video')}
          onAddFromLibrary={() => setLibPickTrack(menuCtx.track === 'audio' ? 'audio' : 'video')}
          onPreview={() => (menuCtx.track === 'audio' ? doPreviewAudioTrack() : doPreviewNarration())}
          onRegenNarration={() => void startDraftGen()}
          onDownloadNarration={() => void doDownloadNarration()}
          onAddVideoTrack={() => onTimelineChange(addTrack(timeline, 'video'))}
          onAddAudioTrack={() => onTimelineChange(addTrack(timeline, 'audio'))}
          onRemoveTrack={(tid) => onTimelineChange(removeTrack(timeline, tid))}
          onDeleteClip={(id) => {
            if (menuCtx.track === 'subtitle') {
              const idx = Number(id);
              setCues((prev) => prev.filter((_, i) => i !== idx));
            } else {
              onTimelineChange(deleteAnyClip(timeline, id));
            }
          }}
          onClose={() => setMenuCtx(null)} />
      )}
      {/* #26/#28 片段间转场菜单(名称前带图示) */}
      {txMenu && (
        <div className="fixed z-[300] min-w-[132px] overflow-hidden rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] py-1 shadow-xl"
          style={{ left: txMenu.x, top: txMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="px-3 py-1 text-[10px] text-[var(--cy-text-tertiary)]">片段间转场</div>
          {TRANSITIONS.map(({ value, label, icon: Icon }) => {
            const cur = (timeline.tracks ?? []).flatMap((t) => t.clips ?? []).find((c) => c.id === txMenu.clipId)?.transition ?? 'none';
            const active = cur === value;
            return (
              <button key={value} type="button"
                onClick={() => { onTimelineChange(setClipTransition(timeline, txMenu.clipId, value)); setTxMenu(null); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${active ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
                <Icon className="h-3.5 w-3.5 text-[var(--cy-brand-500)]" /> {label}
              </button>
            );
          })}
        </div>
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
      {/* 字幕整体编辑框 */}
      {subtitleEditorOpen && (
        <SubtitleBulkEditor cues={cues}
          onSave={(lines) => { setCues(rebuildCuesFromLines(cues, lines, contentMs)); setSubtitleEditorOpen(false); }}
          onRegenAudio={(t) => {
            const st = useVgComposer.getState();
            st.setScriptSlot('manual', t); st.setScriptSource('manual'); st.resetDraft();
            setSubtitleEditorOpen(false);
          }}
          onClose={() => setSubtitleEditorOpen(false)} />
      )}
      {/* 生成脚本表单(自包含) */}
      {scriptGenOpen && (
        <ScriptGenDialog
          initial={{ subject: params.video_subject || '', model: params.model ?? null, paragraph: params.paragraph_number || 1, language: params.video_language || '' }}
          onSubmit={submitScriptGen}
          onClose={() => setScriptGenOpen(false)} />
      )}
      {scriptEditOpen && (
        <ScriptEditorDialog
          initial={(params.video_script || '').trim()
            || (draft.script || '').trim()
            || cues.map((c) => c.text).join('\n')}
          onSave={onSaveScript}
          onSynthesize={(s) => void onSynthesizeScript(s)}
          onClose={() => setScriptEditOpen(false)} />
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

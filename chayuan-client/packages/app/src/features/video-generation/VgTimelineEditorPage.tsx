import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, RefreshCw, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Crop, SlidersHorizontal, Palette } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import { OutputFramingSection } from './sections/OutputFramingSection';
import { OverlayToolbar } from './timeline/OverlayToolbar';
import { VgAspectPicker } from './VgAspectPicker';
import { videoGeneration, type VgTimeline, type VgOverlay } from '@chayuan/api';
import { useVgComposer, scriptHashOf } from './store/vgComposer';
import { MediaPoolPanel } from './timeline/MediaPoolPanel';
import { PreviewPlayer } from './timeline/PreviewPlayer';
import { TransportBar } from './timeline/TransportBar';
import { TimelineTracks } from './timeline/TimelineTracks';
import { useUsageGate, UsageGateDialogs } from '../license';
import { buildTimelineFromMaterials } from './timeline/buildTimeline';
import { appendClipFromMaterial, appendAudioClip, replaceClipSource, deleteAnyClip, roundTimeline, setClipTransition, applyProbedDuration, patchClip, type DraggedMaterial } from './timeline/timelineEdit';
import { TRANSITIONS } from './timeline/transitions';
import { addTrack, removeTrack, reorderVideoTrack } from './timeline/trackOps';
import { addOverlay, patchOverlay, deleteOverlay } from './timeline/overlayEdit';
import { TrackContextMenu, type TrackMenuCtx } from './timeline/TrackContextMenu';
import { ScriptGenDialog } from './timeline/ScriptGenDialog';
import { ScriptEditorDialog } from './timeline/ScriptEditorDialog';
import { VgSpeechSettings } from './VgAudioPopover';
import { VgSubtitleSettings } from './VgSubtitlePopover';
import { BgmSection } from './sections/BgmSection';
import { SubtitleBulkEditor } from './timeline/SubtitleBulkEditor';
import { TimelineToolbar } from './timeline/TimelineToolbar';
import { rebuildCuesFromLines } from './timeline/subtitleEdit';
import { playAudioTimeline } from './timeline/audioPreview';
import { totalDurationMs, rulerDurationMs, fitPxPerSec } from './timeline/timelineScale';
import { useTimelinePlayback } from './timeline/useTimelinePlayback';
import { useVgDraft } from './timeline/useVgDraft';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { useTabsStore } from '../../store/tabs';

export const VgTimelineEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const draft = useVgComposer((s) => s.timelineDraft);
  const patchDraft = useVgComposer((s) => s.patchDraft);

  const [pxPerSec, setPxPerSec] = React.useState(20);
  const [proxyStale, setProxyStale] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const gate = useUsageGate('video_edit');   // 视频编辑(时间轴合成)按次计费
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

  const { peaks, cues, setCues, runDraftGen, startDraftGen, onSaveScript, onSynthesizeScript }
    = useVgDraft({ params, patchParams, draft, patchDraft, canGen, curHash });

  const [scriptGenOpen, setScriptGenOpen] = React.useState(false);
  const [scriptEditOpen, setScriptEditOpen] = React.useState(false);
  // #18/#19:编辑器内联设置面板(复用会话同款 语音/字幕/背景音乐 section)
  const [settingsPanel, setSettingsPanel] = React.useState<'speech' | 'subtitle' | 'bgm' | null>(null);
  const [subtitleEditorOpen, setSubtitleEditorOpen] = React.useState(false);

  const submitScriptGen = (v: { subject: string; model: string | null; paragraph: number; language: string }) => {
    const next = { ...params, video_subject: v.subject, model: v.model ?? undefined, paragraph_number: v.paragraph, video_language: v.language, script_source: 'ai' as const, video_script: '' };
    patchParams({ video_subject: v.subject, model: v.model ?? undefined, paragraph_number: v.paragraph, video_language: v.language, script_source: 'ai', video_script: '' });
    setScriptGenOpen(false);
    void runDraftGen(next); // 点「生成」立即重生成,不依赖 hash 变化
  };

  const contentMs = totalDurationMs(timeline, draft.audioDurationMs); // 实际成片时长(传输栏显示)
  const durationMs = rulerDurationMs(contentMs); // 标尺/画布展示时长(向后留富余,可放更多元素)

  const { playheadMs, setPlayheadMs, seekMs, setSeekMs, seekNonce, setSeekNonce,
          seekDebounceRef, playing, setPlaying, previewMode, setPreviewMode, playheadRef, playheadDriveRef }
    = useTimelinePlayback({ timeline, contentMs, draft, params });

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
  // 按 clip 自身 source 取缩略图(主轨/PIP 轨通用):material_id→素材缩略图;http url(图片)直接用
  const clipThumb = (c: { source?: { material_id?: string; url?: string } }) => {
    const src = c?.source;
    if (src?.material_id) return videoGeneration.materialThumbUrl(src.material_id);
    if (src?.url && /^https?:/.test(src.url)) return src.url;
    return null;
  };
  const onDropMaterial = (m: DraggedMaterial, trackId?: string, atIndex?: number) => {
    if (m.kind === 'audio') return; // 音频走音频轨
    onTimelineChange(appendClipFromMaterial(timeline, m, atIndex, trackId, contentMs));
    // 视频时长未知(在线/链接无 duration)→ 探测真实时长再回填,保证轨上时长对得上
    if (m.kind === 'video' && (!m.durationMs || m.durationMs <= 0)) probeVideoDuration(m);
  };
  const probeVideoDuration = (m: DraggedMaterial) => {
    const url = m.materialId ? videoGeneration.materialFileUrl(m.materialId) : (m.url || '');
    if (!url) return;
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true;
    const done = () => { v.onloadedmetadata = null; v.onerror = null; v.src = ''; };
    v.onloadedmetadata = () => {
      const durMs = Math.round((v.duration || 0) * 1000);
      done();
      if (durMs <= 0) return;
      const tl = useVgComposer.getState().params.timeline;
      if (tl) onTimelineChange(applyProbedDuration(tl, { materialId: m.materialId, url: m.url }, durMs));
    };
    v.onerror = done;
    v.src = url;
  };
  const onDropAudio = (m: DraggedMaterial, trackId?: string) => { onTimelineChange(appendAudioClip(timeline, m, undefined, trackId)); };
  const [selectedTrackId, setSelectedTrackId] = React.useState<string | null>(null);
  // #10:跨轨选中 clip + Delete/Backspace 删除(焦点在输入框时不拦)
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(null);
  const [selectedOverlayIds, setSelectedOverlayIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedClipId && selectedOverlayIds.length === 0) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (selectedOverlayIds.length) { let tl = timeline; for (const oid of selectedOverlayIds) tl = deleteOverlay(tl, oid); onTimelineChange(tl); setSelectedOverlayIds([]); }
      else if (selectedClipId) { onTimelineChange(deleteAnyClip(timeline, selectedClipId)); setSelectedClipId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId, selectedOverlayIds, timeline]);
  const onSetTransform = (clipId: string, tf: { x?: number; y?: number; scale?: number; rotation?: number; flip_h?: boolean; flip_v?: boolean; opacity?: number; speed?: number; color?: { brightness: number; contrast: number; saturation: number } }) => onTimelineChange(patchClip(timeline, clipId, tf));
  // 裁剪编辑态(P2 几何):同一时间只一个 clip 在裁剪;onCrop 经 patchClip(带 clamp)写入。
  const [cropEditingClipId, setCropEditingClipId] = React.useState<string | null>(null);
  const onToggleCropClip = (clipId: string) => setCropEditingClipId((id) => (id === clipId ? null : clipId));
  const onCrop = (clipId: string, crop: { x: number; y: number; w: number; h: number }) => onTimelineChange(patchClip(timeline, clipId, { crop }));
  // 选中片段(供预览头部几何工具条用 —— 工具条放头部不挡画面)
  const selClip = selectedClipId ? (timeline.tracks || []).flatMap((t) => t.clips || []).find((c) => c.id === selectedClipId) : null;
  // 叠加元素(A 期文字):选中与片段选中互斥
  const onSelectOverlay = (id: string | null, additive = false) => {
    if (!id) { setSelectedOverlayIds([]); return; }
    if (additive) { setSelectedOverlayIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])); }
    else { setSelectedOverlayIds([id]); setSelectedClipId(null); }
  };
  const selectClip = (id: string | null) => { setSelectedClipId(id); if (id) setSelectedOverlayIds([]); };
  const onOverlayTransform = (id: string, tf: Partial<VgOverlay>) => {
    if ((tf.x !== undefined || tf.y !== undefined) && selectedOverlayIds.length > 1 && selectedOverlayIds.includes(id)) {
      const cur = (timeline.overlays || []).find((o) => o.id === id);
      if (cur) {
        const dx = tf.x !== undefined ? tf.x - (cur.x ?? 0) : 0;
        const dy = tf.y !== undefined ? tf.y - (cur.y ?? 0) : 0;
        let tl = timeline;
        for (const oid of selectedOverlayIds) {
          const o = (tl.overlays || []).find((x) => x.id === oid);
          if (o) tl = patchOverlay(tl, oid, { x: (o.x ?? 0) + dx, y: (o.y ?? 0) + dy });
        }
        onTimelineChange(tl);
        return;
      }
    }
    onTimelineChange(patchOverlay(timeline, id, tf));
  };
  const overlayImgInputRef = React.useRef<HTMLInputElement | null>(null);
  const onAddOverlay = (type: 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'image' | 'mosaic') => {
    if (type === 'image') { overlayImgInputRef.current?.click(); return; }
    const { timeline: tl, id } = addOverlay(timeline, type, playheadMs);
    onTimelineChange(tl); setSelectedOverlayIds([id]); setSelectedClipId(null);
  };
  const onOverlayImagePicked = async (file?: File) => {
    if (!file) return;
    try {
      const r = await videoGeneration.uploadOverlayImage(file);
      const { timeline: tl, id } = addOverlay(timeline, 'image', playheadMs, r.name);
      onTimelineChange(tl); setSelectedOverlayIds([id]); setSelectedClipId(null);
    } catch (e) { reportError(e as Error, '叠加图片上传失败'); }
  };
  const selectedOverlayId = selectedOverlayIds.length === 1 ? selectedOverlayIds[0]! : null;
  const selOverlay = selectedOverlayId ? (timeline.overlays || []).find((ov) => ov.id === selectedOverlayId) : null;
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

  // 时间轴有内容(视频轨有 clip)即可提交 —— 不强制先生成旁白
  const hasVideoClips = (timeline.tracks ?? []).some((t) => t.kind === 'video' && (t.clips?.length ?? 0) > 0);
  const canSubmit = draft.state === 'ready' || hasVideoClips;

  const afterSubmitNav = () => {
    notifySuccess('已提交合成', '前往「我的视频」看进度');
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  };

  // ── 提交合成 ──
  // 1) 草稿已就绪(有旁白+字幕)→ finalize:复用 audio/subtitle,只 compose,保留用户编辑的字幕。
  // 2) 否则(无旁白草稿)→ 直接按时间轴提交一个完整任务:有脚本则后端生成旁白,无脚本则
  //    后端走「无旁白」EDL 合成(纯素材+背景音乐/音频轨)。满足「只要有素材/音乐即可合成」。
  const onSubmit = async () => {
    if (draft.state === 'generating') { reportError(new Error('旁白生成中,请稍候再提交')); return; }
    if (!hasVideoClips && draft.state !== 'ready') { reportError(new Error('请先往视频轨添加素材')); return; }
    await gate.guard(async () => {   // 按次扣减「视频编辑」额度,用完弹购买
      setSubmitting(true);
      try {
        if (draft.state === 'ready' && draft.taskId) {
          // 透传当前画幅/精确尺寸,使成片按预览左上角的最终选择渲染(否则用草稿原始尺寸)
          await videoGeneration.finalizeDraft(
            draft.taskId, roundTimeline(timeline), cues.length ? cues : undefined,
            { video_aspect: params.video_aspect, video_width: params.video_width, video_height: params.video_height },
          );
        } else {
          await videoGeneration.submitTask(
            { ...params, timeline: roundTimeline(timeline) }, { stop_at: 'video' },
          );
        }
        afterSubmitNav();
      } catch (e) { reportError(e as Error, '提交失败'); }
      finally { setSubmitting(false); }
    });
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
            <div className="flex min-h-0 flex-1">
              {/* 叠加元素工具条:贴左侧分隔条,在视频区域外 */}
              <OverlayToolbar onAdd={onAddOverlay} />
              <div className="flex min-h-0 flex-1 flex-col">
              {/* 预览头:画幅条 + 折叠 */}
              <div className="px-3 pt-2">
                <div className="flex items-center gap-2 overflow-x-auto">
                  <VgAspectPicker compact />
                {/* 片段几何工具条:常显;未选素材时灰禁用,选中后可编辑(不挡画面) */}
                <div className={'flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 py-0.5 transition-opacity ' + (selClip ? '' : 'opacity-50')}
                  title={selClip ? undefined : '先在预览/时间轴选中片段'}>
                  <span className="text-[10px] text-[var(--cy-text-tertiary)]">片段</span>
                  <button type="button" disabled={!selClip} title="水平翻转" onClick={() => selClip && onSetTransform(selClip.id, { flip_h: !selClip.flip_h })}
                    className={'inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed ' + (selClip?.flip_h ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-secondary)] enabled:hover:bg-[var(--cy-surface-2)]')}><FlipHorizontal2 className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={!selClip} title="垂直翻转" onClick={() => selClip && onSetTransform(selClip.id, { flip_v: !selClip.flip_v })}
                    className={'inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed ' + (selClip?.flip_v ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-secondary)] enabled:hover:bg-[var(--cy-surface-2)]')}><FlipVertical2 className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={!selClip} title={selClip && cropEditingClipId === selClip.id ? '完成裁剪' : '裁剪(在预览拖框)'} onClick={() => selClip && onToggleCropClip(selClip.id)}
                    className={'inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed ' + (selClip && cropEditingClipId === selClip.id ? 'bg-[var(--cy-brand-500)] text-white' : 'text-[var(--cy-text-secondary)] enabled:hover:bg-[var(--cy-surface-2)]')}><Crop className="h-3.5 w-3.5" /></button>
                  <span className="ml-1 text-[10px] text-[var(--cy-text-tertiary)]">透明度</span>
                  <input type="range" min={0} max={1} step={0.05} disabled={!selClip} value={selClip?.opacity ?? 1}
                    onChange={(e) => selClip && onSetTransform(selClip.id, { opacity: Number(e.target.value) })}
                    className="h-1 w-16 accent-[var(--cy-brand-500)] disabled:cursor-not-allowed" />
                  <span className="w-7 text-right text-[10px] tabular-nums text-[var(--cy-text-secondary)]">{Math.round((selClip?.opacity ?? 1) * 100)}%</span>
                  <span className="ml-1 w-9 text-right text-[10px] tabular-nums text-[var(--cy-text-tertiary)]">{Math.round(selClip?.rotation ?? 0)}°</span>
                </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" title="背景 / 片头片尾"
                        className="ml-2 inline-flex shrink-0 items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                        <SlidersHorizontal className="h-3 w-3" /> 输出
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="w-[24rem]">
                      <OutputFramingSection />
                    </PopoverContent>
                  </Popover>
                  <button type="button" onClick={() => setPreviewCollapsed((v) => !v)}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                    <EyeOff className="h-3 w-3" /> 折叠预览
                  </button>
                </div>
                {selOverlay && (
                  <div className="mt-1 flex items-center gap-1 overflow-x-auto pb-0.5">
                {selOverlay && (
                  <div className="flex items-center gap-1 rounded-md border border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)]/40 px-1.5 py-0.5">
                    <span className="text-[10px] text-[var(--cy-text-tertiary)]">{selOverlay.type === 'text' ? '文字' : '图形'}</span>
                    {selOverlay.type === 'text' && (
                      <>
                        <input type="color" value={selOverlay.text_color || '#ffffff'} title="文字色"
                          onChange={(e) => onOverlayTransform(selOverlay.id, { text_color: e.target.value })}
                          className="h-6 w-7 rounded border border-[var(--cy-border-subtle)] bg-transparent p-0" />
                        <input type="number" min={8} max={200} value={selOverlay.font_size ?? 48} title="字号"
                          onChange={(e) => onOverlayTransform(selOverlay.id, { font_size: parseInt(e.target.value, 10) || 48 })}
                          className="h-6 w-12 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]" />
                        <select value={selOverlay.align || 'center'} title="对齐"
                          onChange={(e) => onOverlayTransform(selOverlay.id, { align: e.target.value as 'left' | 'center' | 'right' })}
                          className="h-6 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]">
                          <option value="left">左</option><option value="center">中</option><option value="right">右</option>
                        </select>
                      </>
                    )}
                    {(selOverlay.type === 'rect' || selOverlay.type === 'ellipse') && (
                      <label className="flex items-center gap-0.5 text-[10px] text-[var(--cy-text-tertiary)]">填充
                        <input type="color" value={(selOverlay.fill && selOverlay.fill.slice(0, 7)) || '#ffffff'} title="填充色"
                          onChange={(e) => onOverlayTransform(selOverlay.id, { fill: e.target.value })}
                          className="h-6 w-7 rounded border border-[var(--cy-border-subtle)] bg-transparent p-0" />
                        <button type="button" title="无填充" onClick={() => onOverlayTransform(selOverlay.id, { fill: null })}
                          className="rounded px-1 hover:bg-[var(--cy-surface-2)]">无</button>
                      </label>
                    )}
                    {selOverlay.type === 'rect' && (
                      <input type="number" min={0} max={200} value={selOverlay.corner_radius ?? 0} title="圆角"
                        onChange={(e) => onOverlayTransform(selOverlay.id, { corner_radius: parseInt(e.target.value, 10) || 0 })}
                        className="h-6 w-12 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]" />
                    )}
                    <input type="color" value={selOverlay.stroke_color || '#000000'} title="描边色"
                      onChange={(e) => onOverlayTransform(selOverlay.id, { stroke_color: e.target.value })}
                      className="h-6 w-7 rounded border border-[var(--cy-border-subtle)] bg-transparent p-0" />
                    <input type="number" min={0} max={40} step={0.5} value={selOverlay.stroke_width ?? 1.5} title="描边宽"
                      onChange={(e) => onOverlayTransform(selOverlay.id, { stroke_width: parseFloat(e.target.value) || 0 })}
                      className="h-6 w-12 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]" />
                    <input type="range" min={0} max={1} step={0.05} value={selOverlay.opacity ?? 1} title="透明度"
                      onChange={(e) => onOverlayTransform(selOverlay.id, { opacity: parseFloat(e.target.value) })}
                      className="h-1 w-14 accent-[var(--cy-brand-500)]" />
                    <span className="ml-1 text-[10px] text-[var(--cy-text-tertiary)]">入</span>
                    <select value={selOverlay.anim_in || 'none'} title="入场动画"
                      onChange={(e) => onOverlayTransform(selOverlay.id, { anim_in: e.target.value as 'none' | 'fade' })}
                      className="h-6 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]">
                      <option value="none">无</option><option value="fade">淡入</option>
                    </select>
                    <span className="text-[10px] text-[var(--cy-text-tertiary)]">出</span>
                    <select value={selOverlay.anim_out || 'none'} title="出场动画"
                      onChange={(e) => onOverlayTransform(selOverlay.id, { anim_out: e.target.value as 'none' | 'fade' })}
                      className="h-6 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]">
                      <option value="none">无</option><option value="fade">淡出</option>
                    </select>
                    {selOverlay.type === 'text' && (
                      <select value="" title="文字预设"
                        onChange={(e) => {
                          const P: Record<string, Partial<VgOverlay>> = {
                            title: { text_color: '#ffffff', stroke_color: '#000000', stroke_width: 3, font_size: 64, bg: null },
                            warn: { text_color: '#ff3b30', stroke_color: '#000000', stroke_width: 4, font_size: 56, bg: null },
                            cap: { text_color: '#ffffff', stroke_color: '#000000', stroke_width: 0, font_size: 40, bg: '#000000' },
                            neon: { text_color: '#39ff14', stroke_color: '#39ff14', stroke_width: 2, font_size: 56, bg: null },
                          };
                          const v = P[e.target.value]; if (v) onOverlayTransform(selOverlay.id, v);
                        }}
                        className="h-6 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 text-[11px]">
                        <option value="">字样</option><option value="title">标题白</option><option value="warn">警示红</option><option value="cap">字幕黑底</option><option value="neon">霓虹</option>
                      </select>
                    )}
                  </div>
                )}
                </div>
                )}
              </div>
              <div className="min-h-0 flex-1 p-3">
                <input ref={overlayImgInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { void onOverlayImagePicked(e.target.files?.[0]); e.currentTarget.value = ''; }} />
                <PreviewPlayer
                  timeline={timeline} aspect={params.video_aspect}
                  width={params.video_width} height={params.video_height}
                  playheadMs={playheadMs} seekMs={seekMs} playing={playing} stale={proxyStale}
                  onTimeMs={(ms) => setPlayheadMs(ms)}
                  onPlayingChange={setPlaying}
                  onFreshGenerated={() => setProxyStale(false)}
                  onTransform={onSetTransform}
                  cropEditingClipId={cropEditingClipId}
                  onCrop={onCrop}
                  selectedClipId={selectedClipId}
                  onSelectClip={selectClip}
                  backgroundColor={params.background_color}
                  overlays={timeline.overlays}
                  selectedOverlayIds={selectedOverlayIds}
                  onSelectOverlay={onSelectOverlay}
                  onOverlayTransform={onOverlayTransform}
                  onModeChange={setPreviewMode}
                  cues={cues}
                  taskId={draft.taskId} audioFileName={draft.audioFileName}
                  composeParams={{ ...params, timeline }}
                />
              </div>
              </div>
              <div className="flex w-9 shrink-0 flex-col items-center border-l border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] py-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" title="调色 / 变速"
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                      <Palette className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="left" align="start" className="max-h-[60vh] w-48 space-y-2 overflow-y-auto text-[11px]">
                    {selClip ? (
                      <>
                        <div className="font-medium text-[var(--cy-text-secondary)]">调色</div>
                        <select title="调色预设" value=""
                          onChange={(e) => {
                            const P: Record<string, { brightness: number; contrast: number; saturation: number }> = {
                              orig: { brightness: 1, contrast: 1, saturation: 1 }, bw: { brightness: 1, contrast: 1, saturation: 0 },
                              vivid: { brightness: 1, contrast: 1.05, saturation: 1.4 }, warm: { brightness: 1.05, contrast: 1.05, saturation: 1.1 },
                              hc: { brightness: 1, contrast: 1.3, saturation: 1 },
                            };
                            const v = P[e.target.value]; if (v) onSetTransform(selClip.id, { color: v });
                          }}
                          className="h-7 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1">
                          <option value="">预设…</option><option value="orig">原图</option><option value="bw">黑白</option><option value="vivid">鲜艳</option><option value="warm">暖</option><option value="hc">高对比</option>
                        </select>
                        {(['brightness', 'contrast', 'saturation'] as const).map((k) => (
                          <label key={k} className="flex flex-col gap-0.5">
                            <span className="flex justify-between text-[10px] text-[var(--cy-text-tertiary)]"><span>{k === 'brightness' ? '亮度' : k === 'contrast' ? '对比度' : '饱和度'}</span><span className="tabular-nums">{(selClip.color?.[k] ?? 1).toFixed(2)}</span></span>
                            <input type="range" min={0} max={3} step={0.05} value={selClip.color?.[k] ?? 1}
                              onChange={(e) => onSetTransform(selClip.id, { color: { brightness: 1, contrast: 1, saturation: 1, ...(selClip.color || {}), [k]: parseFloat(e.target.value) } })}
                              className="w-full accent-[var(--cy-brand-500)]" />
                          </label>
                        ))}
                        <div className="pt-1 font-medium text-[var(--cy-text-secondary)]">变速</div>
                        <select title="变速" value={String(selClip.speed ?? 1)}
                          onChange={(e) => onSetTransform(selClip.id, { speed: parseFloat(e.target.value) })}
                          className="h-7 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1">
                          {['0.25', '0.5', '0.75', '1', '1.5', '2', '3', '4'].map((v) => <option key={v} value={v}>{v}×</option>)}
                        </select>
                      </>
                    ) : (
                      <p className="text-[var(--cy-text-tertiary)]">先在预览/时间轴选中片段</p>
                    )}
                  </PopoverContent>
                </Popover>
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
        <TimelineToolbar
          timelineCollapsed={timelineCollapsed}
          onToggleCollapse={() => setTimelineCollapsed((v) => !v)}
          onScriptGen={() => setScriptGenOpen(true)}
          onScriptEdit={() => setScriptEditOpen(true)}
          onSubtitleEdit={() => setSubtitleEditorOpen(true)}
          settingsPanel={settingsPanel}
          onSettingsPanel={setSettingsPanel}
          submitting={submitting}
          canSubmit={canSubmit}
          onSubmit={() => void onSubmit()}
        />
        {!timelineCollapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
        <TimelineTracks
          timeline={timeline} durationMs={durationMs} pxPerSec={pxPerSec} playheadMs={playheadMs}
          peaks={peaks} peaksLoading={draft.state === 'generating'} cues={cues} bgmName={bgmName} bgmUrl={bgmUrl} contentMs={contentMs}
          thumbUrlOf={thumbUrlOf}
          clipThumb={clipThumb}
          onDropAudio={onDropAudio}
          onCuesChange={setCues}
          onReplaceClip={onReplaceClip}
          onDropMaterial={onDropMaterial}
          onLaneContextMenu={onLaneContextMenu}
          selectedTrackId={selectedTrackId}
          onSelectTrack={setSelectedTrackId}
          onReorderVideoTrack={(tid, dir) => onTimelineChange(reorderVideoTrack(timeline, tid, dir))}
          selectedClipId={selectedClipId}
          onSelectClip={selectClip}
          overlays={timeline.overlays}
          selectedOverlayIds={selectedOverlayIds}
          onSelectOverlay={onSelectOverlay}
          onOverlayPatch={(id, patch) => onTimelineChange(patchOverlay(timeline, id, patch))}
          onOverlayDelete={(id) => { onTimelineChange(deleteOverlay(timeline, id)); setSelectedOverlayIds((prev) => prev.filter((x) => x !== id)); }}
          playheadDriveRef={playheadDriveRef}
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
              onTimelineChange(replaceClipSource(timeline, replacingClipId, { material_id: m.material_id }, mimeKind(m.mime) === 'image' ? 'image' : 'video'));
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
      <UsageGateDialogs app="video_edit" gate={gate} />
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

import * as React from 'react';
import { Mic, Captions, Music, Music2, Clapperboard, PictureInPicture2, Volume2, VolumeX, SlidersVertical, Type } from 'lucide-react';
import type { VgTimeline, VgTimelineTrack } from '@chayuan/api';
import type { SrtCue } from './srtParse';
import { msToPx, pxToMs } from './timelineScale';
import { clipDurMs, setTrackAudio } from './timelineEdit';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { TrackHeader, TRACK_H } from './TrackHeader';
import { VgTimeline as VideoTrack } from './VgTimeline';
import { AudioWaveTrack } from './AudioWaveTrack';
import { AudioInsertTrack } from './AudioInsertTrack';
import { SubtitleCueTrack } from './SubtitleCueTrack';
import { OverlayLane } from './OverlayLane';
import { BgmTrack } from './BgmTrack';
import { VerticalSliderPopover } from './VerticalSliderPopover';
import { VG_MATERIAL_DND_MIME, type DraggedMaterial } from './timelineEdit';

const HEADER_W = 84;
const RULER_H = 24;

export const TimelineTracks: React.FC<{
  timeline: VgTimeline;
  durationMs: number;
  pxPerSec: number;
  playheadMs: number;
  peaks: number[];
  peaksLoading?: boolean;
  cues: SrtCue[];
  bgmName: string | null;
  bgmUrl?: string;
  contentMs?: number;
  thumbUrlOf?: (clipIndex: number) => string | null;
  clipThumb?: (clip: { source?: { material_id?: string; url?: string } }) => string | null;
  onSeekMs: (ms: number) => void;
  onTimelineChange: (t: VgTimeline) => void;
  onDropMaterial?: (m: DraggedMaterial, trackId?: string, atIndex?: number) => void;
  onDropAudio?: (m: DraggedMaterial, trackId?: string) => void;
  onCuesChange?: (cues: SrtCue[]) => void;
  onReplaceClip?: (clipId: string) => void;
  onLaneContextMenu?: (e: React.MouseEvent, track: 'video' | 'audio' | 'subtitle' | 'narration', clipId?: string, trackId?: string, removable?: boolean) => void;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
  onReorderVideoTrack?: (trackId: string, dir: 'up' | 'down') => void;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string) => void;
  overlays?: import('@chayuan/api').VgOverlay[];
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  onOverlayPatch?: (id: string, patch: { track_start_ms?: number; duration_ms?: number }) => void;
  onOverlayDelete?: (id: string) => void;
  /** 旁白音频块显示名(主题名)+ 时长。 */
  narrationName?: string;
  narrationDurationMs?: number;
  onTransitionMenu?: (e: React.MouseEvent, clipId: string) => void;
  /** 播放头命令式驱动 ref(rAF 每帧推 DOM,不重渲整条时间轴);透传给 Playhead。 */
  playheadDriveRef?: React.MutableRefObject<((ms: number) => void) | null>;
}> = ({ timeline, durationMs, pxPerSec, playheadMs, peaks, peaksLoading, cues, bgmName, bgmUrl, contentMs, thumbUrlOf, clipThumb, onSeekMs, onTimelineChange, onDropMaterial, onDropAudio, onCuesChange, onReplaceClip, onLaneContextMenu, selectedTrackId, onSelectTrack, onReorderVideoTrack, selectedClipId, onSelectClip, overlays, selectedOverlayId, onSelectOverlay, onOverlayPatch, onOverlayDelete, narrationName, narrationDurationMs, onTransitionMenu, playheadDriveRef }) => {
  const contentWidthPx = Math.max(240, msToPx(durationMs, pxPerSec));
  // 刻度固定:右侧面板自成垂直滚动容器,左侧轨道头列 scrollTop 跟随同步
  const lanesScrollRef = React.useRef<HTMLDivElement>(null);
  const headerColRef = React.useRef<HTMLDivElement>(null);
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const audioTracks = (timeline.tracks || []).filter((t) => t.kind === 'audio');
  const audioLanes: (VgTimelineTrack | null)[] = audioTracks.length ? audioTracks : [null]; // 至少一条插入音频 lane(可拖)
  const laneCount = videoTracks.length + 1 /*旁白*/ + audioLanes.length + 1 /*音乐*/ + 1 /*字幕*/ + 1 /*叠加*/;
  const lanesH = TRACK_H * laneCount;
  const selCls = (id?: string) => (id && id === selectedTrackId ? ' ring-2 ring-inset ring-[var(--cy-brand-400)]' : '');
  // 时间轴各轨是专用 drop 区 → dragover 一律 preventDefault(否则浏览器禁止 drop)。
  // 不要按 dataTransfer.types.includes(MIME) gating:Tauri 的 WebKitGTK 在 dragover
  // 阶段**不暴露**自定义 MIME 到 types(只在 drop 才可读)→ gating 会让 preventDefault
  // 永不触发,desktop 上整个拖放失效(dev Chrome 正常)。payload 合法性在 drop 里
  // getData(MIME) 校验,非素材拖拽 raw 为空会被早返回,无副作用。
  const dragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  // #26 主轨拖放精确定位:按指针 X 算插入索引 + 边界像素(落在第几个片段之间)
  const [dropMark, setDropMark] = React.useState<{ trackId: string; index: number; leftPx: number } | null>(null);
  const computeInsert = (e: React.DragEvent, tr: VgTimelineTrack) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const xMs = pxToMs(Math.max(0, e.clientX - rect.left), pxPerSec);
    const clips = [...(tr.clips || [])].sort((a, b) => a.track_start_ms - b.track_start_ms);
    let index = 0; let boundaryMs = 0;
    for (const c of clips) {
      const mid = c.track_start_ms + clipDurMs(c) / 2;
      if (xMs > mid) { index++; boundaryMs = c.track_start_ms + clipDurMs(c); } else break;
    }
    return { index, leftPx: msToPx(boundaryMs, pxPerSec) };
  };
  // 轨道头竖直拖动 → 每越过一格 TRACK_H 触发一次上/下移
  const startHeaderDrag = (e: React.PointerEvent, trackId: string) => {
    if (!onReorderVideoTrack) return;
    e.preventDefault();
    let baseY = e.clientY;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - baseY;
      if (Math.abs(dy) >= TRACK_H) { onReorderVideoTrack(trackId, dy < 0 ? 'up' : 'down'); baseY = ev.clientY; }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex h-full min-h-0 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      {/* 左:固定轨道头列 */}
      <div ref={headerColRef} className="shrink-0 overflow-hidden border-r border-[var(--cy-border-subtle)]" style={{ width: HEADER_W }}>
        <div style={{ height: RULER_H }} className="sticky top-0 z-20 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]" />
        {videoTracks.map((tr, i) => (
          <div key={tr.id} className={`${selCls(tr.id)} ${onReorderVideoTrack && videoTracks.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onClick={() => onSelectTrack?.(tr.id)}
            onPointerDown={(e) => { if (videoTracks.length > 1) startHeaderDrag(e, tr.id); }}
            title={videoTracks.length > 1 ? '上下拖动调整图层顺序(越靠上越上层)' : undefined}>
            {/* 标签/图标按「轨道身份」(removable)走,不绑 index —— 重排时主轨整体移动 */}
            <TrackHeader
              label={tr.label || (!tr.removable ? '主视频' : `视频 ${i + 1}`)}
              icon={!tr.removable
                ? <Clapperboard className="h-3 w-3 text-[var(--cy-brand-600)]" />
                : <PictureInPicture2 className="h-3 w-3 text-[var(--cy-text-tertiary)]" />}
              action={(tr.clips && tr.clips.length > 0) ? (() => {
                const allMuted = tr.clips.every((c) => c.muted);
                const vol = tr.clips[0]?.volume ?? 1;
                return (
                  <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" title={allMuted ? '取消静音(混入该轨视频原声)' : '静音该轨视频原声'}
                      onClick={() => onTimelineChange(setTrackAudio(timeline, tr.id, { muted: !allMuted }))}
                      className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">
                      {allMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                    {!allMuted && (
                      <VerticalSliderPopover value={vol} min={0} max={1.5} step={0.05}
                        title={`音量 ${vol.toFixed(2)}`} format={(v) => v.toFixed(2)}
                        icon={<SlidersVertical className="h-3 w-3" />}
                        onChange={(v) => onTimelineChange(setTrackAudio(timeline, tr.id, { volume: v }))} />
                    )}
                  </span>
                );
              })() : undefined} />
          </div>
        ))}
        <div onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'narration'); } }}>
          <TrackHeader label="旁白" icon={<Mic className="h-3 w-3" />} />
        </div>
        {audioLanes.map((tr, i) => (
          <div key={tr?.id ?? `a${i}`} className={selCls(tr?.id)} onClick={() => tr && onSelectTrack?.(tr.id)}>
            <TrackHeader label={tr?.label || (i === 0 ? '音频' : `音频 ${i + 1}`)} icon={<Music2 className="h-3 w-3" />} />
          </div>
        ))}
        <TrackHeader label="音乐" icon={<Music className="h-3 w-3" />} />
        <TrackHeader label="字幕" icon={<Captions className="h-3 w-3" />} />
        <TrackHeader label="叠加" icon={<Type className="h-3 w-3" />} />
      </div>
      {/* 右:横向+纵向滚动容器;刻度 sticky 固定在顶,左列 scrollTop 跟随 */}
      <div
        ref={lanesScrollRef}
        onScroll={(e) => { if (headerColRef.current) headerColRef.current.scrollTop = e.currentTarget.scrollTop; }}
        className="relative flex-1 overflow-auto cy-hide-scrollbar"
      >
        <div className="relative" style={{ width: contentWidthPx }}>
          <div className="sticky top-0 z-20 bg-[var(--cy-surface-1)]">
            <TimeRuler durationMs={durationMs} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} onSeekMs={onSeekMs} />
          </div>
          <div className="relative" style={{ height: lanesH }}>
            {/* 视频轨们(第 0 条 = 主轨可编辑;其余 = PIP 显示+拖入+右键) */}
            {videoTracks.map((tr, i) => {
              return (
                <div key={tr.id} style={{ height: TRACK_H }}
                  className={`relative border-b border-[var(--cy-border-subtle)]${selCls(tr.id)}`}
                  onClick={() => onSelectTrack?.(tr.id)}
                  onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'video', undefined, tr.id, !!tr.removable); } }}
                  onDragOver={(e) => { dragOver(e); if (i === 0) { const { index, leftPx } = computeInsert(e, tr); setDropMark({ trackId: tr.id, index, leftPx }); } }}
                  onDragLeave={() => setDropMark((d) => (d?.trackId === tr.id ? null : d))}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                    setDropMark(null);
                    if (!raw) return; e.preventDefault();
                    try {
                      const m = JSON.parse(raw) as DraggedMaterial;
                      if (m.kind === 'audio') return;
                      const at = i === 0 ? computeInsert(e, tr).index : undefined;
                      onDropMaterial?.(m, tr.id, at);
                    } catch { /* 忽略 */ }
                  }}>
                  {dropMark?.trackId === tr.id && (
                    <span className="pointer-events-none absolute top-0 z-30 h-full w-0.5 bg-[var(--cy-brand-500)]"
                      style={{ left: Math.max(0, dropMark.leftPx - 1) }} />
                  )}
                  {/* 所有视频轨(含 PIP/附加轨)都可编辑(拖拽调时长)+ 显缩略图;
                      thumbUrlOf 按主轨下标只给主轨,clipThumb 按 clip 自身 source 给全部轨 */}
                  <VideoTrack timeline={timeline} trackId={tr.id} editable videoTrackOnly pxPerSec={pxPerSec}
                    thumbUrlOf={!tr.removable ? thumbUrlOf : undefined} clipThumb={clipThumb} onChange={onTimelineChange} onReplaceClip={onReplaceClip}
                    selectedClipId={selectedClipId} onSelectClip={onSelectClip}
                    onTransitionMenu={onTransitionMenu}
                    onClipContextMenu={(e, clipId) => onLaneContextMenu?.(e, 'video', clipId, tr.id, !!tr.removable)} />
                </div>
              );
            })}
            <div onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'narration'); } }}>
              <AudioWaveTrack peaks={peaks} contentWidthPx={contentWidthPx} loading={peaksLoading}
                label={narrationName} durationMs={narrationDurationMs} pxPerSec={pxPerSec} />
            </div>
            {/* 插入音频轨们 */}
            {audioLanes.map((tr, i) => (
              <div key={tr?.id ?? `a${i}`} style={{ height: TRACK_H }}
                className={`relative border-b border-[var(--cy-border-subtle)]${selCls(tr?.id)}`}
                onClick={() => tr && onSelectTrack?.(tr.id)}
                onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'audio', undefined, tr?.id, !!tr?.removable); } }}
                onDragOver={dragOver}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                  if (!raw) return; e.preventDefault();
                  try { const m = JSON.parse(raw) as DraggedMaterial; if (m.kind === 'audio') onDropAudio?.(m, tr?.id); } catch { /* 忽略 */ }
                }}>
                <AudioInsertTrack timeline={timeline} trackId={tr?.id} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
                  onChange={onTimelineChange} selectedClipId={selectedClipId} onSelectClip={onSelectClip}
                  onClipContextMenu={(e, clipId) => onLaneContextMenu?.(e, 'audio', clipId, tr?.id, !!tr?.removable)} />
              </div>
            ))}
            <BgmTrack bgmName={bgmName} bgmUrl={bgmUrl} contentWidthPx={contentWidthPx}
              bgmWidthPx={contentMs != null ? msToPx(contentMs, pxPerSec) : undefined} />
            <SubtitleCueTrack cues={cues} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
              editable onCuesChange={onCuesChange}
              onCueContextMenu={(e, idx) => onLaneContextMenu?.(e, 'subtitle', String(idx))} />
            <OverlayLane overlays={overlays} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
              selectedOverlayId={selectedOverlayId} onSelect={onSelectOverlay}
              onPatch={onOverlayPatch} onDelete={onOverlayDelete} />
          </div>
          {/* 播放头:贯穿刻度 + 所有轨道;手柄在最顶(刻度上方) */}
          <Playhead playheadMs={playheadMs} pxPerSec={pxPerSec} heightPx={RULER_H + lanesH} durationMs={durationMs} onSeekMs={onSeekMs} driveRef={playheadDriveRef} />
        </div>
      </div>
    </div>
  );
};

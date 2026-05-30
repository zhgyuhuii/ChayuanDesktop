import * as React from 'react';
import { Mic, Captions, Music, Music2, Clapperboard, PictureInPicture2 } from 'lucide-react';
import type { VgTimeline, VgTimelineTrack } from '@chayuan/api';
import type { SrtCue } from './srtParse';
import { msToPx, pxToMs } from './timelineScale';
import { clipDurMs } from './timelineEdit';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { TrackHeader, TRACK_H } from './TrackHeader';
import { VgTimeline as VideoTrack } from './VgTimeline';
import { AudioWaveTrack } from './AudioWaveTrack';
import { AudioInsertTrack } from './AudioInsertTrack';
import { SubtitleCueTrack } from './SubtitleCueTrack';
import { BgmTrack } from './BgmTrack';
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
  /** 旁白音频块显示名(主题名)+ 时长。 */
  narrationName?: string;
  narrationDurationMs?: number;
  onTransitionMenu?: (e: React.MouseEvent, clipId: string) => void;
}> = ({ timeline, durationMs, pxPerSec, playheadMs, peaks, peaksLoading, cues, bgmName, bgmUrl, contentMs, thumbUrlOf, onSeekMs, onTimelineChange, onDropMaterial, onDropAudio, onCuesChange, onReplaceClip, onLaneContextMenu, selectedTrackId, onSelectTrack, onReorderVideoTrack, selectedClipId, onSelectClip, narrationName, narrationDurationMs, onTransitionMenu }) => {
  const contentWidthPx = Math.max(240, msToPx(durationMs, pxPerSec));
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const audioTracks = (timeline.tracks || []).filter((t) => t.kind === 'audio');
  const audioLanes: (VgTimelineTrack | null)[] = audioTracks.length ? audioTracks : [null]; // 至少一条插入音频 lane(可拖)
  const laneCount = videoTracks.length + 1 /*旁白*/ + audioLanes.length + 1 /*音乐*/ + 1 /*字幕*/;
  const lanesH = TRACK_H * laneCount;
  const selCls = (id?: string) => (id && id === selectedTrackId ? ' ring-2 ring-inset ring-[var(--cy-brand-400)]' : '');
  const dragOver = (e: React.DragEvent) => { if (e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
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
    <div className="flex rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      {/* 左:固定轨道头列 */}
      <div className="shrink-0 border-r border-[var(--cy-border-subtle)]" style={{ width: HEADER_W }}>
        <div style={{ height: RULER_H }} className="border-b border-[var(--cy-border-subtle)]" />
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
                : <PictureInPicture2 className="h-3 w-3 text-[var(--cy-text-tertiary)]" />} />
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
      </div>
      {/* 右:单横向滚动容器 */}
      <div className="relative flex-1 overflow-x-auto cy-hide-scrollbar">
        <div className="relative" style={{ width: contentWidthPx }}>
          <TimeRuler durationMs={durationMs} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} onSeekMs={onSeekMs} />
          <div className="relative" style={{ height: lanesH }}>
            {/* 视频轨们(第 0 条 = 主轨可编辑;其余 = PIP 显示+拖入+右键) */}
            {videoTracks.map((tr, i) => {
              return (
                <div key={tr.id} style={{ height: TRACK_H }}
                  className={`relative border-b border-[var(--cy-border-subtle)]${selCls(tr.id)}`}
                  onClick={() => onSelectTrack?.(tr.id)}
                  onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'video', undefined, tr.id, !!tr.removable); } }}
                  onDragOver={(e) => { dragOver(e); if (i === 0 && e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { const { index, leftPx } = computeInsert(e, tr); setDropMark({ trackId: tr.id, index, leftPx }); } }}
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
                  <VideoTrack timeline={timeline} trackId={tr.id} editable={!tr.removable} videoTrackOnly pxPerSec={pxPerSec}
                    thumbUrlOf={!tr.removable ? thumbUrlOf : undefined} onChange={onTimelineChange} onReplaceClip={onReplaceClip}
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
          </div>
          {/* 播放头:贯穿刻度 + 所有轨道;手柄在最顶(刻度上方) */}
          <Playhead playheadMs={playheadMs} pxPerSec={pxPerSec} heightPx={RULER_H + lanesH} durationMs={durationMs} onSeekMs={onSeekMs} />
        </div>
      </div>
    </div>
  );
};

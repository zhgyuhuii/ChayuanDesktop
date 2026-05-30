import * as React from 'react';
import { Mic, Captions, Music, Music2, Clapperboard, PictureInPicture2, Play, Download } from 'lucide-react';
import type { VgTimeline, VgTimelineTrack } from '@chayuan/api';
import type { SrtCue } from './srtParse';
import { msToPx } from './timelineScale';
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
  thumbUrlOf?: (clipIndex: number) => string | null;
  onSeekMs: (ms: number) => void;
  onTimelineChange: (t: VgTimeline) => void;
  onDropMaterial?: (m: DraggedMaterial, trackId?: string) => void;
  onDropAudio?: (m: DraggedMaterial, trackId?: string) => void;
  onCuesChange?: (cues: SrtCue[]) => void;
  onReplaceClip?: (clipId: string) => void;
  onLaneContextMenu?: (e: React.MouseEvent, track: 'video' | 'audio' | 'subtitle' | 'narration', clipId?: string, trackId?: string, removable?: boolean) => void;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
  onReorderVideoTrack?: (trackId: string, dir: 'up' | 'down') => void;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string) => void;
  /** 旁白音频就绪 → 在旁白轨叠 试听/下载。 */
  narrationReady?: boolean;
  onPreviewNarration?: () => void;
  onDownloadNarration?: () => void;
}> = ({ timeline, durationMs, pxPerSec, playheadMs, peaks, peaksLoading, cues, bgmName, bgmUrl, thumbUrlOf, onSeekMs, onTimelineChange, onDropMaterial, onDropAudio, onCuesChange, onReplaceClip, onLaneContextMenu, selectedTrackId, onSelectTrack, onReorderVideoTrack, selectedClipId, onSelectClip, narrationReady, onPreviewNarration, onDownloadNarration }) => {
  const contentWidthPx = Math.max(240, msToPx(durationMs, pxPerSec));
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const audioTracks = (timeline.tracks || []).filter((t) => t.kind === 'audio');
  const audioLanes: (VgTimelineTrack | null)[] = audioTracks.length ? audioTracks : [null]; // 至少一条插入音频 lane(可拖)
  const laneCount = videoTracks.length + 1 /*旁白*/ + audioLanes.length + 1 /*音乐*/ + 1 /*字幕*/;
  const lanesH = TRACK_H * laneCount;
  const selCls = (id?: string) => (id && id === selectedTrackId ? ' ring-2 ring-inset ring-[var(--cy-brand-400)]' : '');
  const dragOver = (e: React.DragEvent) => { if (e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
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
            <TrackHeader
              label={i === 0 ? '视频' : (tr.label || `视频 ${i + 1}`)}
              icon={i === 0
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
        <div style={{ width: contentWidthPx }}>
          <TimeRuler durationMs={durationMs} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} onSeekMs={onSeekMs} />
          <div className="relative" style={{ height: lanesH }}>
            {/* 视频轨们(第 0 条 = 主轨可编辑;其余 = PIP 显示+拖入+右键) */}
            {videoTracks.map((tr, i) => {
              const empty = (tr.clips?.length ?? 0) === 0;
              return (
                <div key={tr.id} style={{ height: TRACK_H }}
                  className={`relative border-b border-[var(--cy-border-subtle)]${selCls(tr.id)}`}
                  onClick={() => onSelectTrack?.(tr.id)}
                  onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'video', undefined, tr.id, !!tr.removable); } }}
                  onDragOver={dragOver}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                    if (!raw) return; e.preventDefault();
                    try { const m = JSON.parse(raw) as DraggedMaterial; if (m.kind !== 'audio') onDropMaterial?.(m, tr.id); } catch { /* 忽略 */ }
                  }}>
                  {empty && (
                    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">
                      {i === 0 ? '从左侧素材库拖 视频 / 图像 到此处' : '拖素材到此处作画中画'}
                    </span>
                  )}
                  <VideoTrack timeline={timeline} trackId={tr.id} editable={i === 0} videoTrackOnly pxPerSec={pxPerSec}
                    thumbUrlOf={i === 0 ? thumbUrlOf : undefined} onChange={onTimelineChange} onReplaceClip={onReplaceClip}
                    selectedClipId={selectedClipId} onSelectClip={onSelectClip}
                    onClipContextMenu={(e, clipId) => onLaneContextMenu?.(e, 'video', clipId, tr.id, !!tr.removable)} />
                </div>
              );
            })}
            <div className="relative" onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'narration'); } }}>
              <AudioWaveTrack peaks={peaks} contentWidthPx={contentWidthPx} loading={peaksLoading} />
              {narrationReady && (
                <div className="absolute left-1 top-1 z-20 flex gap-1">
                  <button type="button" title="试听旁白" onClick={(e) => { e.stopPropagation(); onPreviewNarration?.(); }}
                    className="inline-flex h-5 items-center gap-0.5 rounded border border-[var(--cy-brand-300)] bg-white/85 px-1 text-[9px] text-[var(--cy-brand-700)] hover:bg-white">
                    <Play className="h-3 w-3" /> 试听
                  </button>
                  <button type="button" title="下载旁白音频" onClick={(e) => { e.stopPropagation(); onDownloadNarration?.(); }}
                    className="inline-flex h-5 items-center gap-0.5 rounded border border-[var(--cy-border-strong)] bg-white/85 px-1 text-[9px] text-[var(--cy-text-secondary)] hover:bg-white">
                    <Download className="h-3 w-3" /> 下载
                  </button>
                </div>
              )}
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
            <BgmTrack bgmName={bgmName} bgmUrl={bgmUrl} contentWidthPx={contentWidthPx} />
            <SubtitleCueTrack cues={cues} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
              editable onCuesChange={onCuesChange}
              onCueContextMenu={(e, idx) => onLaneContextMenu?.(e, 'subtitle', String(idx))} />
            <Playhead playheadMs={playheadMs} pxPerSec={pxPerSec} heightPx={lanesH} durationMs={durationMs} onSeekMs={onSeekMs} />
          </div>
        </div>
      </div>
    </div>
  );
};

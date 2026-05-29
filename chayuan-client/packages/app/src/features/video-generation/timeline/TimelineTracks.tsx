import * as React from 'react';
import { Film, Mic, Captions, Music, Music2, Pencil } from 'lucide-react';
import type { VgTimeline } from '@chayuan/api';
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

const HEADER_W = 64;
const RULER_H = 24;

const VgTimelineDropHint: React.FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]" style={{ height: TRACK_H }}>
      从左侧素材库拖 视频 / 图像 到此处
    </div>
  ) : null;

export const TimelineTracks: React.FC<{
  timeline: VgTimeline;
  durationMs: number;
  pxPerSec: number;
  playheadMs: number;
  peaks: number[];
  peaksLoading?: boolean;
  cues: SrtCue[];
  bgmName: string | null;
  thumbUrlOf?: (clipIndex: number) => string | null;
  onSeekMs: (ms: number) => void;
  onTimelineChange: (t: VgTimeline) => void;
  onDropMaterial?: (m: DraggedMaterial) => void;
  onDropAudio?: (m: DraggedMaterial) => void;
  onCuesChange?: (cues: SrtCue[]) => void;
  onReplaceClip?: (clipId: string) => void;
  onLaneContextMenu?: (e: React.MouseEvent, track: 'video' | 'audio', clipId?: string) => void;
  onEditSubtitle?: () => void;
}> = ({ timeline, durationMs, pxPerSec, playheadMs, peaks, peaksLoading, cues, bgmName, thumbUrlOf, onSeekMs, onTimelineChange, onDropMaterial, onDropAudio, onCuesChange, onReplaceClip, onLaneContextMenu, onEditSubtitle }) => {
  const contentWidthPx = Math.max(240, msToPx(durationMs, pxPerSec));
  const lanesH = TRACK_H * 5;
  const videoEmpty = !timeline.tracks?.some((t) => t.kind === 'video' && (t.clips?.length ?? 0) > 0);
  const hdrBtn = 'inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]';

  return (
    <div className="flex rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      {/* 左:固定轨道头列 */}
      <div className="shrink-0 border-r border-[var(--cy-border-subtle)]" style={{ width: HEADER_W }}>
        <div style={{ height: RULER_H }} className="border-b border-[var(--cy-border-subtle)]" />
        <TrackHeader label="视频" icon={<Film className="h-3 w-3" />} />
        <TrackHeader label="旁白" icon={<Mic className="h-3 w-3" />} />
        <TrackHeader label="音频" icon={<Music2 className="h-3 w-3" />} />
        <TrackHeader label="音乐" icon={<Music className="h-3 w-3" />} />
        {/* 字幕轨头「编辑」按钮:整体编辑字幕(试听已移到右键菜单) */}
        <TrackHeader label="字幕" icon={<Captions className="h-3 w-3" />}
          action={onEditSubtitle && <button type="button" className={hdrBtn} title="整体编辑字幕" onClick={onEditSubtitle}><Pencil className="h-3 w-3" /></button>} />
      </div>
      {/* 右:单横向滚动容器(ruler + lanes + playhead 共享坐标系) */}
      <div className="relative flex-1 overflow-x-auto cy-hide-scrollbar">
        <div style={{ width: contentWidthPx }}>
          <TimeRuler durationMs={durationMs} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} onSeekMs={onSeekMs} />
          <div className="relative" style={{ height: lanesH }}>
            {/* 视频轨(可编辑 + 缩略图 + 拖素材入轨) */}
            <div style={{ height: TRACK_H }}
              className="relative border-b border-[var(--cy-border-subtle)]"
              onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'video'); } }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                if (!raw) return;
                e.preventDefault();
                try { onDropMaterial?.(JSON.parse(raw) as DraggedMaterial); } catch { /* 非法 payload 忽略 */ }
              }}
            >
              <VgTimelineDropHint show={videoEmpty} />
              <VideoTrack timeline={timeline} editable videoTrackOnly pxPerSec={pxPerSec}
                thumbUrlOf={thumbUrlOf} onChange={onTimelineChange} onReplaceClip={onReplaceClip}
                onClipContextMenu={(e, clipId) => onLaneContextMenu?.(e, 'video', clipId)} />
            </div>
            <AudioWaveTrack peaks={peaks} contentWidthPx={contentWidthPx} loading={peaksLoading} />
            {/* 插入音频轨(drop 音频素材) */}
            <div style={{ height: TRACK_H }} className="relative border-b border-[var(--cy-border-subtle)]"
              onContextMenu={(e) => { if (onLaneContextMenu) { e.preventDefault(); onLaneContextMenu(e, 'audio'); } }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                if (!raw) return;
                e.preventDefault();
                try { const m = JSON.parse(raw) as DraggedMaterial; if (m.kind === 'audio') onDropAudio?.(m); } catch { /* 忽略 */ }
              }}>
              <AudioInsertTrack timeline={timeline} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
                onClipContextMenu={(e, clipId) => onLaneContextMenu?.(e, 'audio', clipId)} />
            </div>
            <BgmTrack bgmName={bgmName} contentWidthPx={contentWidthPx} />
            <SubtitleCueTrack cues={cues} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
              editable onCuesChange={onCuesChange} />
            {/* 播放头贯穿五轨 */}
            <Playhead playheadMs={playheadMs} pxPerSec={pxPerSec} heightPx={lanesH} durationMs={durationMs} onSeekMs={onSeekMs} />
          </div>
        </div>
      </div>
    </div>
  );
};

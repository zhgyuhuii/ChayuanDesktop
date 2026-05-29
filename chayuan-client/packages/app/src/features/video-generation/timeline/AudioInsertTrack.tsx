import * as React from 'react';
import { Music2 } from 'lucide-react';
import type { VgTimeline } from '@chayuan/api';
import { msToPx } from './timelineScale';
import { clipDurMs } from './timelineEdit';
import { TRACK_H } from './TrackHeader';

/** 插入音频轨:按 track_start_ms + clipDurMs 绝对定位音频 clip 块(只读展示)。 */
export const AudioInsertTrack: React.FC<{
  timeline: VgTimeline;
  pxPerSec: number;
  contentWidthPx: number;
  onClipContextMenu?: (e: React.MouseEvent, clipId: string) => void;
  trackId?: string;
}> = ({ timeline, pxPerSec, contentWidthPx, onClipContextMenu, trackId }) => {
  const clips = (trackId
    ? (timeline.tracks || []).find((t) => t.id === trackId)
    : (timeline.tracks || []).find((t) => t.kind === 'audio'))?.clips ?? [];
  return (
    <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {clips.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">拖音频到此处</span>}
      {clips.map((c) => (
        <div key={c.id}
          onContextMenu={(e) => { if (onClipContextMenu) { e.preventDefault(); onClipContextMenu(e, c.id); } }}
          style={{ left: msToPx(c.track_start_ms, pxPerSec), width: Math.max(12, msToPx(clipDurMs(c), pxPerSec)) }}
          className="absolute top-1.5 flex h-8 items-center gap-1 overflow-hidden rounded border border-sky-300 bg-sky-50 px-1 text-[9px] text-sky-800">
          <Music2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{c.source.material_id || c.source.url || '音频'}</span>
        </div>
      ))}
    </div>
  );
};

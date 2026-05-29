import * as React from 'react';
import { msToPx } from './timelineScale';
import { TRACK_H } from './TrackHeader';
import type { SrtCue } from './srtParse';

export const SubtitleCueTrack: React.FC<{
  cues: SrtCue[];
  pxPerSec: number;
  contentWidthPx: number;
}> = ({ cues, pxPerSec, contentWidthPx }) => (
  <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
    style={{ height: TRACK_H, width: contentWidthPx }}>
    {cues.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">字幕(渲染后生成)</span>}
    {cues.map((c, i) => (
      <div key={i}
        style={{ left: msToPx(c.startMs, pxPerSec), width: Math.max(8, msToPx(c.endMs - c.startMs, pxPerSec)) }}
        className="absolute top-1.5 flex h-8 items-center overflow-hidden rounded border border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-800"
        title={c.text}>
        <span className="truncate">{c.text}</span>
      </div>
    ))}
  </div>
);

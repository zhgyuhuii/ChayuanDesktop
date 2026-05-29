import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';

/** 顶部时间刻度。宽度 = contentWidthPx(由父级算)。点击 seek。 */
export const TimeRuler: React.FC<{
  durationMs: number;
  pxPerSec: number;
  contentWidthPx: number;
  onSeekMs: (ms: number) => void;
}> = ({ durationMs, pxPerSec, contentWidthPx, onSeekMs }) => {
  // 刻度间隔:px/秒 越小,秒间隔越大(避免标签挤一起)
  const stepSec = pxPerSec >= 40 ? 1 : pxPerSec >= 20 ? 2 : pxPerSec >= 10 ? 5 : 10;
  const totalSec = Math.ceil(durationMs / 1000);
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s += stepSec) ticks.push(s);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div
      className="relative h-6 cursor-pointer select-none border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]"
      style={{ width: contentWidthPx }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeekMs(Math.max(0, Math.min(durationMs, pxToMs(e.clientX - rect.left, pxPerSec))));
      }}
    >
      {ticks.map((s) => (
        <div key={s} className="absolute top-0 h-full" style={{ left: msToPx(s * 1000, pxPerSec) }}>
          <div className="h-2 w-px bg-[var(--cy-border-strong)]" />
          <span className="absolute left-1 top-1 text-[9px] text-[var(--cy-text-tertiary)]">{fmt(s)}</span>
        </div>
      ))}
    </div>
  );
};

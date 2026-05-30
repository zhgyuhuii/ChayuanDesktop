import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';

/** 顶部时间刻度:主刻度(秒,长线+数字)+ 次刻度(短线)。宽度=contentWidthPx。点击 seek。 */
export const TimeRuler: React.FC<{
  durationMs: number;
  pxPerSec: number;
  contentWidthPx: number;
  onSeekMs: (ms: number) => void;
}> = ({ durationMs, pxPerSec, contentWidthPx, onSeekMs }) => {
  // 主刻度间隔(秒):px/秒 越小,间隔越大,避免数字挤一起
  const stepSec = pxPerSec >= 40 ? 1 : pxPerSec >= 20 ? 2 : pxPerSec >= 10 ? 5 : 10;
  const minorPerMajor = 5;                       // 每个主刻度分 5 个次刻度
  const minorSec = stepSec / minorPerMajor;
  const totalSec = Math.ceil(durationMs / 1000);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  const minors: number[] = [];
  for (let s = 0; s <= totalSec + stepSec; s += minorSec) minors.push(s);
  const majors: number[] = [];
  for (let s = 0; s <= totalSec; s += stepSec) majors.push(s);

  return (
    <div
      className="relative h-6 cursor-pointer select-none border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]"
      style={{ width: contentWidthPx }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeekMs(Math.max(0, Math.min(durationMs, pxToMs(e.clientX - rect.left, pxPerSec))));
      }}
    >
      {/* 次刻度短线 */}
      {minors.map((s, i) => (
        <div key={`m${i}`} className="absolute bottom-0 w-px bg-[var(--cy-border-strong)]/50"
          style={{ left: msToPx(s * 1000, pxPerSec), height: 6 }} />
      ))}
      {/* 主刻度长线 + 数字 */}
      {majors.map((s) => (
        <div key={`M${s}`} className="absolute bottom-0" style={{ left: msToPx(s * 1000, pxPerSec) }}>
          <div className="w-px bg-[var(--cy-border-strong)]" style={{ height: 11 }} />
          <span className="absolute left-1 top-0 text-[9px] leading-none text-[var(--cy-text-tertiary)]">{fmt(s)}</span>
        </div>
      ))}
    </div>
  );
};

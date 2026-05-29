import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';

/** 播放头竖线(滚动内容内绝对定位)。拖动 / 由 video 联动定位。 */
export const Playhead: React.FC<{
  playheadMs: number;
  pxPerSec: number;
  heightPx: number;
  durationMs: number;
  onSeekMs: (ms: number) => void;
}> = ({ playheadMs, pxPerSec, heightPx, durationMs, onSeekMs }) => {
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rail = (e.currentTarget.parentElement as HTMLElement) ?? null;
    const railLeft = rail ? rail.getBoundingClientRect().left : 0;
    const move = (ev: PointerEvent) => {
      onSeekMs(Math.max(0, Math.min(durationMs, pxToMs(ev.clientX - railLeft, pxPerSec))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="pointer-events-none absolute top-0 z-30"
      style={{ left: msToPx(playheadMs, pxPerSec), height: heightPx }}
    >
      <div className="h-full w-px bg-[var(--cy-brand-600)]" />
      <div
        className="pointer-events-auto absolute -left-1.5 top-0 h-3 w-3 cursor-ew-resize rounded-sm bg-[var(--cy-brand-600)]"
        onPointerDown={startDrag}
      />
    </div>
  );
};

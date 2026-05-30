import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';

/**
 * 播放头:贯穿刻度 + 所有轨道的竖线,顶部一个可拖动手柄(在刻度上方)。
 * 拖动手柄 → onSeekMs 跳转(父组件据此 seek + 播放态下从该位置续播)。
 */
export const Playhead: React.FC<{
  playheadMs: number;
  pxPerSec: number;
  heightPx: number;
  durationMs: number;
  onSeekMs: (ms: number) => void;
}> = ({ playheadMs, pxPerSec, heightPx, durationMs, onSeekMs }) => {
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 相对「内容层」(Playhead 的父级 = contentWidthPx 容器)算位置
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
      className="pointer-events-none absolute top-0 z-40"
      style={{ left: msToPx(playheadMs, pxPerSec), height: heightPx }}
    >
      {/* 贯穿竖线 */}
      <div className="h-full w-px bg-[var(--cy-brand-600)]" />
      {/* 顶部手柄(在刻度上方),下接倒三角指向竖线 */}
      <div
        className="pointer-events-auto absolute -top-0.5 -left-2 flex flex-col items-center cursor-ew-resize"
        onPointerDown={startDrag}
        title="拖动定位播放头"
      >
        <div className="h-2.5 w-4 rounded-[2px] bg-[var(--cy-brand-600)] shadow" />
        <div className="h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-[var(--cy-brand-600)]" />
      </div>
    </div>
  );
};

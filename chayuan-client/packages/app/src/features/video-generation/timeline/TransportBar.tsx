import * as React from 'react';
import { Play, Pause, ZoomIn, ZoomOut } from 'lucide-react';
import { PPS_MIN, PPS_MAX, clampPxPerSec } from './timelineScale';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const TransportBar: React.FC<{
  playing: boolean;
  currentMs: number;
  durationMs: number;
  pxPerSec: number;
  onPlayPause: () => void;
  onZoom: (pxPerSec: number) => void;
}> = ({ playing, currentMs, durationMs, pxPerSec, onPlayPause, onZoom }) => (
  <div className="flex items-center gap-3 border-y border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-1.5">
    <button type="button" onClick={onPlayPause}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white hover:bg-[var(--cy-brand-600)]">
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
    </button>
    <span className="font-mono text-xs text-[var(--cy-text-secondary)]">
      {fmt(currentMs)} / {fmt(durationMs)}
    </span>
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" onClick={() => onZoom(clampPxPerSec(pxPerSec / 1.5))}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="缩小">
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <input type="range" min={PPS_MIN} max={PPS_MAX} step={1} value={pxPerSec}
        onChange={(e) => onZoom(clampPxPerSec(Number(e.target.value)))}
        className="h-1 w-28 accent-[var(--cy-brand-500)]" />
      <button type="button" onClick={() => onZoom(clampPxPerSec(pxPerSec * 1.5))}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="放大">
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

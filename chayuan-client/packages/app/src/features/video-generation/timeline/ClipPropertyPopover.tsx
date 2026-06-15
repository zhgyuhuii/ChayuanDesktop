import * as React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { VgTimeline, VgTimelineClip } from '@chayuan/api';
import { patchClip, type ClipPatch } from './timelineEdit';

const NumField: React.FC<{ label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }>
  = ({ label, value, step, min, max, onChange }) => (
  <label className="flex items-center gap-1">
    <span className="w-9 shrink-0 text-[var(--cy-text-tertiary)]">{label}</span>
    <input type="number" value={value} step={step} min={min} max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1 py-0.5 tabular-nums" />
  </label>
);

/**
 * 选中片段的「属性」弹层。复用 VgAspectPicker 的点外关/Esc 范式。
 * isPip=true(画中画/附加视频轨)才显示透明度 + 位置/缩放/层级(后端只对 PIP 层 with_opacity、
 * 主轨拼接没有透明度/层级语义)。所有写入走 patchClip(带 clamp)。
 */
export const ClipPropertyPopover: React.FC<{
  timeline: VgTimeline;
  clip: VgTimelineClip;
  isPip: boolean;
  onChange: (t: VgTimeline) => void;
  onClose: () => void;
}> = ({ timeline, clip, isPip, onChange, onClose }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const set = (patch: ClipPatch) => onChange(patchClip(timeline, clip.id, patch));
  const muted = !!clip.muted;
  const opacity = clip.opacity ?? 1;
  const volume = clip.volume ?? 1;

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
      className="absolute -top-2 left-0 z-[230] w-52 -translate-y-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-[11px] shadow-xl">
      <p className="mb-1 font-medium text-[var(--cy-text-secondary)]">片段属性</p>

      {isPip && (
        <label className="mb-1 flex items-center gap-2">
          <span className="w-10 shrink-0 text-[var(--cy-text-tertiary)]">透明度</span>
          <input type="range" min={0} max={1} step={0.05} value={opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            className="flex-1 accent-[var(--cy-brand-500)]" />
          <span className="w-8 shrink-0 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
        </label>
      )}

      <label className="mb-1 flex items-center gap-2">
        <button type="button" title={muted ? '取消静音' : '静音'} onClick={() => set({ muted: !muted })}
          className="shrink-0 text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-primary)]">
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <input type="range" min={0} max={1.5} step={0.05} value={volume} disabled={muted}
          onChange={(e) => set({ volume: Number(e.target.value) })}
          className="flex-1 accent-[var(--cy-brand-500)] disabled:opacity-40" />
        <span className="w-8 shrink-0 text-right tabular-nums">{volume.toFixed(2)}</span>
      </label>

      {isPip && (
        <div className="grid grid-cols-2 gap-1">
          <NumField label="位置X" value={clip.x ?? 0} step={0.01} min={0} max={1} onChange={(v) => set({ x: v })} />
          <NumField label="位置Y" value={clip.y ?? 0} step={0.01} min={0} max={1} onChange={(v) => set({ y: v })} />
          <NumField label="缩放" value={clip.scale ?? 1} step={0.01} min={0.05} max={1} onChange={(v) => set({ scale: v })} />
          <NumField label="层级" value={clip.z ?? 0} step={1} min={0} max={99} onChange={(v) => set({ z: v })} />
        </div>
      )}
    </div>
  );
};

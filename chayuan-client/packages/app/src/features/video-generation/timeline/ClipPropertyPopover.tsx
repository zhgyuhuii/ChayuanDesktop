import * as React from 'react';
import { Volume2, VolumeX, RotateCw, FlipHorizontal2, FlipVertical2, Crop } from 'lucide-react';
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
  cropEditing: boolean;
  onToggleCrop: () => void;
  onChange: (t: VgTimeline) => void;
}> = ({ timeline, clip, isPip, cropEditing, onToggleCrop, onChange }) => {
  // 定位/外部点击/Esc 全交给外层 Radix Popover(portal,脱离时间轴 overflow 裁剪)。
  const set = (patch: ClipPatch) => onChange(patchClip(timeline, clip.id, patch));
  const muted = !!clip.muted;
  const opacity = clip.opacity ?? 1;
  const volume = clip.volume ?? 1;

  return (
    <div className="text-[11px] text-[var(--cy-text-primary)]">
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

      {/* 几何变换(P2)—— 仅 PIP 层:旋转 / 翻转 / 裁剪 */}
      {isPip && (
        <>
          <label className="mb-1 flex items-center gap-2">
            <RotateCw className="h-3.5 w-3.5 shrink-0 text-[var(--cy-text-tertiary)]" />
            <input type="range" min={-180} max={180} step={1} value={clip.rotation ?? 0}
              onChange={(e) => set({ rotation: Number(e.target.value) })}
              className="flex-1 accent-[var(--cy-brand-500)]" />
            <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(clip.rotation ?? 0)}°</span>
          </label>
          <div className="mb-1 flex items-center gap-1">
            <button type="button" title="水平翻转" aria-pressed={!!clip.flip_h}
              onClick={() => set({ flip_h: !clip.flip_h })}
              className={'inline-flex h-7 w-7 items-center justify-center rounded ' + (clip.flip_h ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="垂直翻转" aria-pressed={!!clip.flip_v}
              onClick={() => set({ flip_v: !clip.flip_v })}
              className={'inline-flex h-7 w-7 items-center justify-center rounded ' + (clip.flip_v ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
              <FlipVertical2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" title={cropEditing ? '完成裁剪' : '裁剪（在预览里拖框）'} aria-pressed={cropEditing}
              onClick={onToggleCrop}
              className={'ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] ' + (cropEditing ? 'bg-[var(--cy-brand-500)] text-white' : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
              <Crop className="h-3.5 w-3.5" /> {cropEditing ? '完成裁剪' : '裁剪'}
            </button>
          </div>
        </>
      )}

      {/* 层级 z 不放控件:后端 _build_pip_layers 按「轨道顺序」决定层级、不读 clip.z,
          预览也按轨道下标排 zIndex —— 暴露 z 数值是「调了不生效」的误导控件,故不提供。
          画中画层级由上下拖动视频轨调整。 */}
      {isPip && (
        <div className="grid grid-cols-2 gap-1">
          <NumField label="位置X" value={clip.x ?? 0} step={0.01} min={0} max={1} onChange={(v) => set({ x: v })} />
          <NumField label="位置Y" value={clip.y ?? 0} step={0.01} min={0} max={1} onChange={(v) => set({ y: v })} />
          <NumField label="缩放" value={clip.scale ?? 1} step={0.01} min={0.05} max={1} onChange={(v) => set({ scale: v })} />
        </div>
      )}
    </div>
  );
};

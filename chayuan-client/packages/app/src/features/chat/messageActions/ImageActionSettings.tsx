/** 受控文生图设置(对话内联产出)——size 预设 + 张数 n。 */
import * as React from 'react';
import { cn } from '@chayuan/ui';

export interface ImageSettings { size: string; n: number }
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = { size: '1024*1024', n: 1 };
const SIZES = [
  { v: '1024*1024', l: '1:1' }, { v: '1664*928', l: '16:9' }, { v: '928*1664', l: '9:16' },
  { v: '1472*1104', l: '4:3' }, { v: '1104*1472', l: '3:4' },
];
const N_OPTS = [1, 2, 3, 4];
const chip = (active: boolean) => cn('inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
  active ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]');

export const ImageActionSettings: React.FC<{ value: ImageSettings; onChange: (v: ImageSettings) => void }> = ({ value, onChange }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
    <span className="opacity-60">比例</span>
    <div className="flex items-center gap-0.5">
      {SIZES.map((s) => (
        <button key={s.v} type="button" onClick={() => onChange({ ...value, size: s.v })} aria-pressed={value.size === s.v} className={chip(value.size === s.v)}>{s.l}</button>
      ))}
    </div>
    <span className="mx-1 opacity-30">·</span>
    <span className="opacity-60">张数</span>
    <div className="flex items-center gap-0.5">
      {N_OPTS.map((n) => (
        <button key={n} type="button" onClick={() => onChange({ ...value, n })} aria-pressed={value.n === n} className={chip(value.n === n)}>{n}</button>
      ))}
    </div>
  </div>
);

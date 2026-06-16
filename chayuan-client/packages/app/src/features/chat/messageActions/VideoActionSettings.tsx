/** 受控文生视频设置(对话内联产出)——size 预设 + 时长。 */
import * as React from 'react';
import { cn } from '@chayuan/ui';

export interface VideoSettings { size: string; duration: number }
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { size: '1280*720', duration: 5 };
const SIZES = [
  { v: '1280*720', l: '横 16:9' }, { v: '720*1280', l: '竖 9:16' }, { v: '960*960', l: '方 1:1' },
];
const DUR = [2, 5, 10];
const chip = (active: boolean) => cn('inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
  active ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]');

export const VideoActionSettings: React.FC<{ value: VideoSettings; onChange: (v: VideoSettings) => void }> = ({ value, onChange }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
    <span className="opacity-60">画幅</span>
    <div className="flex items-center gap-0.5">
      {SIZES.map((s) => (
        <button key={s.v} type="button" onClick={() => onChange({ ...value, size: s.v })} aria-pressed={value.size === s.v} className={chip(value.size === s.v)}>{s.l}</button>
      ))}
    </div>
    <span className="mx-1 opacity-30">·</span>
    <span className="opacity-60">时长</span>
    <div className="flex items-center gap-0.5">
      {DUR.map((d) => (
        <button key={d} type="button" onClick={() => onChange({ ...value, duration: d })} aria-pressed={value.duration === d} className={chip(value.duration === d)}>{d}s</button>
      ))}
    </div>
  </div>
);

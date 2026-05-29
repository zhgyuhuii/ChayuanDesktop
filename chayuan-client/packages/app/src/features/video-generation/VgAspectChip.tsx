/**
 * 画幅 / 输出设置。
 *
 * - VgAspectChip:精简 3 按钮(竖/横/方),保留给旧调用方。
 * - VgOutputSettings:VgComposerToolbar "画幅设置" 面板用的完整内联参数条 ——
 *   画幅(可视比例块)+ 生成个数 + 单段时长 + 拼接 + 转场。对齐 TtsVoiceParamBar 风格。
 *
 * 注:视频画幅后端只支持 16:9 / 9:16 / 1:1(VideoAspect enum + to_resolution,
 * 上游 MoneyPrinterTurbo 同样只这三种)。4:3 / 3:4 是图像生成才有的比例,
 * 视频合成管线把素材拼进固定画框,暂不支持,故这里不列。
 */
import * as React from 'react';
import { cn } from '@chayuan/ui';
import type { VgTransitionMode, VgConcatMode } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';

const ASPECTS = [
  { v: '9:16' as const, label: '竖' },
  { v: '16:9' as const, label: '横' },
  { v: '1:1'  as const, label: '方' },
];

export const VgAspectChip: React.FC = () => {
  const aspect = useVgComposer((s) => s.params.video_aspect);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-0.5 text-xs">
      {ASPECTS.map((a) => (
        <button
          key={a.v}
          type="button"
          onClick={() => patch({ video_aspect: a.v })}
          className={
            'rounded px-1.5 py-0.5 transition-colors ' +
            (aspect === a.v
              ? 'bg-[var(--cy-brand-500)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')
          }
          title={`画幅 ${a.v}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
};

// ── VgOutputSettings:画幅 + 视频输出参数(toolbar 画幅设置面板) ──────────

const ASPECT_OPTIONS: Array<{ v: '16:9' | '9:16' | '1:1'; label: string; box: string }> = [
  { v: '9:16', label: '竖屏 9:16', box: 'h-5 w-[14px]' },
  { v: '16:9', label: '横屏 16:9', box: 'h-[14px] w-5' },
  { v: '1:1',  label: '方形 1:1',  box: 'h-4 w-4' },
];
const COUNT_OPTIONS = [1, 2, 3, 5] as const;
const CLIP_OPTIONS = [3, 5, 8, 10] as const;
const CONCAT_OPTIONS: Array<{ v: VgConcatMode; label: string }> = [
  { v: 'random', label: '随机' },
  { v: 'sequential', label: '顺序' },
];
const TRANSITIONS: Array<{ v: VgTransitionMode; label: string }> = [
  { v: '', label: '无' },
  { v: 'FadeIn', label: '淡入' },
  { v: 'FadeOut', label: '淡出' },
  { v: 'SlideIn', label: '滑入' },
  { v: 'SlideOut', label: '滑出' },
  { v: 'Shuffle', label: '随机' },
];

const chipCls = (active: boolean) =>
  cn(
    'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors',
    active
      ? 'bg-[var(--cy-ink-700)] text-white'
      : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]',
  );

export const VgOutputSettings: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);

  return (
    <div
      role="toolbar"
      aria-label="画幅设置"
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]"
    >
      {/* 画幅 — 可视比例块 */}
      <span className="opacity-60">画幅</span>
      <div className="flex items-center gap-0.5">
        {ASPECT_OPTIONS.map((a) => (
          <button
            key={a.v}
            type="button"
            onClick={() => patch({ video_aspect: a.v })}
            aria-pressed={params.video_aspect === a.v}
            className={chipCls(params.video_aspect === a.v)}
            title={a.label}
          >
            <span
              className={cn(
                'inline-block rounded-[2px] border',
                a.box,
                params.video_aspect === a.v ? 'border-white bg-white/30' : 'border-current opacity-60',
              )}
            />
            {a.label}
          </button>
        ))}
      </div>

      <span className="mx-1 opacity-30">·</span>

      {/* 生成个数 */}
      <span className="opacity-60">生成个数</span>
      <div className="flex items-center gap-0.5">
        {COUNT_OPTIONS.map((n) => (
          <button key={n} type="button" onClick={() => patch({ video_count: n })}
            aria-pressed={params.video_count === n} className={chipCls(params.video_count === n)}>
            {n}
          </button>
        ))}
      </div>

      <span className="mx-1 opacity-30">·</span>

      {/* 单段时长 */}
      <span className="opacity-60">单段(s)</span>
      <div className="flex items-center gap-0.5">
        {CLIP_OPTIONS.map((s) => (
          <button key={s} type="button" onClick={() => patch({ video_clip_duration: s })}
            aria-pressed={params.video_clip_duration === s} className={chipCls(params.video_clip_duration === s)}>
            {s}
          </button>
        ))}
      </div>

      <span className="mx-1 opacity-30">·</span>

      {/* 拼接 */}
      <span className="opacity-60">拼接</span>
      <div className="flex items-center gap-0.5">
        {CONCAT_OPTIONS.map((c) => (
          <button key={c.v} type="button" onClick={() => patch({ video_concat_mode: c.v })}
            aria-pressed={params.video_concat_mode === c.v} className={chipCls(params.video_concat_mode === c.v)}>
            {c.label}
          </button>
        ))}
      </div>

      <span className="mx-1 opacity-30">·</span>

      {/* 转场 */}
      <span className="opacity-60">转场</span>
      <select
        value={params.video_transition_mode}
        onChange={(e) => patch({ video_transition_mode: e.target.value as VgTransitionMode })}
        className={cn(
          'h-6 rounded-md border border-[var(--cy-border-subtle)]',
          'bg-[var(--cy-surface-1)] px-1.5 text-[10px] text-[var(--cy-text-primary)]',
          'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
        )}
      >
        {TRANSITIONS.map((t) => (
          <option key={t.v || 'none'} value={t.v}>{t.label}</option>
        ))}
      </select>
    </div>
  );
};

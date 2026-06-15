/**
 * 画幅 / 输出设置。
 *
 * - VgAspectChip:精简 3 按钮(竖/横/方),保留给旧调用方。
 * - VgOutputSettings:VgComposerToolbar "画幅设置" 面板用的完整内联参数条 ——
 *   画幅(VgAspectPicker 分组弹面板,预设+自定义)+ 生成个数 + 单段时长 + 拼接 + 转场。
 *
 * 画幅真源是 video_width/video_height(精确像素优先),video_aspect 兜底。
 * 见 VgAspectPicker / server schemas.resolve_resolution。
 */
import * as React from 'react';
import { cn } from '@chayuan/ui';
import type { VgTransitionMode, VgConcatMode } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';
import { useTranslation } from '../../i18n';
import { VgAspectPicker } from './VgAspectPicker';

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

const COUNT_OPTIONS = [1, 2, 3, 5] as const;
const CLIP_OPTIONS = [3, 5, 8, 10] as const;
const CONCAT_OPTIONS: Array<{ v: VgConcatMode; label: string }> = [
  { v: 'random', label: '随机' },
  { v: 'sequential', label: '顺序' },
];
// 转场 enum → i18n key(显示按系统语言;值仍发后端 enum)
const TRANSITIONS: Array<{ v: VgTransitionMode; k: string }> = [
  { v: '', k: 'none' },
  { v: 'FadeIn', k: 'fadeIn' },
  { v: 'FadeOut', k: 'fadeOut' },
  { v: 'SlideIn', k: 'slideIn' },
  { v: 'SlideOut', k: 'slideOut' },
  { v: 'Shuffle', k: 'shuffle' },
];

export const VgOutputSettings: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const { t } = useTranslation();

  const selectCls = cn(
    'h-6 rounded-md border border-[var(--cy-border-subtle)]',
    'bg-[var(--cy-surface-1)] px-1 text-[10px] text-[var(--cy-text-primary)]',
    'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
  );

  return (
    <div
      role="toolbar"
      aria-label="画幅设置"
      className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-[var(--cy-text-secondary)]"
    >
      {/* 画幅 — 分组 Popover(预设 + 自定义),与预览页复用同一组件 */}
      <span className="opacity-60">画幅</span>
      <VgAspectPicker />

      {/* 背景色 — 画面空白处(letterbox/间隙);人人可用 */}
      <span className="ml-1.5 opacity-60">背景</span>
      <input type="color" value={params.background_color}
        onChange={(e) => patch({ background_color: e.target.value })}
        title="画面空白处背景色" className="h-6 w-7 rounded border border-[var(--cy-border-subtle)] bg-transparent p-0" />
      {['#000000', '#ffffff', '#1f2937'].map((c) => (
        <button key={c} type="button" title={c} onClick={() => patch({ background_color: c })}
          className="h-5 w-5 rounded border border-[var(--cy-border-subtle)]" style={{ background: c }} />
      ))}

      {/* 个数 — 下拉省宽 */}
      <span className="ml-1.5 opacity-60">个数</span>
      <select value={params.video_count}
        onChange={(e) => patch({ video_count: parseInt(e.target.value, 10) || 1 })}
        className={selectCls}>
        {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>

      {/* 时长 */}
      <span className="ml-1.5 opacity-60">时长</span>
      <select value={params.video_clip_duration}
        onChange={(e) => patch({ video_clip_duration: parseInt(e.target.value, 10) || 5 })}
        className={selectCls} title="单段最长(秒)">
        {CLIP_OPTIONS.map((s) => <option key={s} value={s}>{s}s</option>)}
      </select>

      {/* 拼接 */}
      <span className="ml-1.5 opacity-60">拼接</span>
      <select value={params.video_concat_mode}
        onChange={(e) => patch({ video_concat_mode: e.target.value as VgConcatMode })}
        className={selectCls}>
        {CONCAT_OPTIONS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
      </select>

      {/* 转场 */}
      <span className="ml-1.5 opacity-60">转场</span>
      <select value={params.video_transition_mode}
        onChange={(e) => patch({ video_transition_mode: e.target.value as VgTransitionMode })}
        className={selectCls}>
        {TRANSITIONS.map((o) => <option key={o.k} value={o.v}>{t(`videoGen.transition.${o.k}`)}</option>)}
      </select>
    </div>
  );
};

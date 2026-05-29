/**
 * VgChatPage Composer 正上方工具栏 — 精致紧凑版(对齐 composer/TtsVoiceParamBar)。
 *
 * 第一行 chip 区:画幅 / 语言 / 段落 / 语音设置▾ / 字幕设置▾ / ⚡全自动
 *   - 语音设置 / 字幕设置:点 chip 在下方内联展开参数条(不弹 popover,更紧凑)
 *   - 全自动:末尾的 toggle chip(开=amber)
 * 展开区:openPanel 决定显示 VgSpeechSettings 还是 VgSubtitleSettings。
 *
 * 模型不在这里(ChatComposer 自带 ComposerModelPill)。
 */
import * as React from 'react';
import { Volume2, Type, Zap, ChevronDown } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { VgAspectChip } from './VgAspectChip';
import { VgSpeechSettings } from './VgAudioPopover';
import { VgSubtitleSettings } from './VgSubtitlePopover';
import { useVgComposer } from './store/vgComposer';

export interface VgComposerToolbarProps {
  autoMode: boolean;
  onAutoModeChange: (v: boolean) => void;
}

type Panel = 'speech' | 'subtitle' | null;

const triggerCls = (active: boolean) =>
  cn(
    'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
    active
      ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
      : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]',
  );

export const VgComposerToolbar: React.FC<VgComposerToolbarProps> = ({
  autoMode,
  onAutoModeChange,
}) => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const [open, setOpen] = React.useState<Panel>(null);
  const toggle = (p: Panel) => setOpen((cur) => (cur === p ? null : p));

  return (
    <div className="rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      {/* 展开区 — 内联参数条,在 chip 行**上方**展开(toolbar 贴着输入框,
          向上展开不会把输入框往下挤) */}
      {open && (
        <div className="border-b border-[var(--cy-border-subtle)] px-3 py-2">
          {open === 'speech' ? <VgSpeechSettings /> : <VgSubtitleSettings />}
        </div>
      )}
      {/* chip 行 */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
        <div className="inline-flex items-center gap-1">
          <span className="text-[var(--cy-text-tertiary)]">画幅</span>
          <VgAspectChip />
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-[var(--cy-text-tertiary)]">语言</span>
          <select
            value={params.video_language}
            onChange={(e) => patch({ video_language: e.target.value })}
            className="h-7 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5"
          >
            <option value="">自动</option>
            <option value="zh-CN">中文</option>
            <option value="en-US">英文</option>
            <option value="ja-JP">日文</option>
          </select>
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-[var(--cy-text-tertiary)]">段落</span>
          <input
            type="number"
            min={1} max={10}
            value={params.paragraph_number}
            onChange={(e) =>
              patch({
                paragraph_number: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)),
              })
            }
            className="h-7 w-12 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 text-center"
          />
        </div>

        {/* 语音设置 trigger */}
        <button type="button" onClick={() => toggle('speech')} className={triggerCls(open === 'speech')}>
          <Volume2 className="h-3 w-3 text-[var(--cy-brand-500)]" />
          语音设置
          <ChevronDown className={cn('h-3 w-3 transition-transform', open === 'speech' && 'rotate-180')} />
        </button>

        {/* 字幕设置 trigger */}
        <button type="button" onClick={() => toggle('subtitle')} className={triggerCls(open === 'subtitle')}>
          <Type className="h-3 w-3 text-[var(--cy-brand-500)]" />
          字幕设置
          <ChevronDown className={cn('h-3 w-3 transition-transform', open === 'subtitle' && 'rotate-180')} />
        </button>

        {/* 全自动 — 末尾 toggle chip */}
        <button
          type="button"
          onClick={() => onAutoModeChange(!autoMode)}
          aria-pressed={autoMode}
          title={autoMode ? '全自动:输入主题直接生成视频' : '关:生成脚本→你审→点去生成'}
          className={cn(
            'ml-auto inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
            autoMode
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]',
          )}
        >
          <Zap className={cn('h-3 w-3', autoMode ? 'fill-amber-400 text-amber-500' : 'text-[var(--cy-text-tertiary)]')} />
          {autoMode ? '全自动 开' : '全自动'}
        </button>
      </div>
    </div>
  );
};

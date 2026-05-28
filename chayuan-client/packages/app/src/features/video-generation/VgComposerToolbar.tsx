/**
 * VgChatPage Composer 上方的工具栏 — 7 chip 显式露:
 *   模型 / 画幅 / 语言 / 段落 / 🔊音频 / Aa字幕 / ⚡全自动
 *
 * 用户明确要求关键配置不藏 popover 在底栏(原 N4-N8 设计的反模式),
 * 现在每个关键 chip 都在 toolbar 一行显示;复杂多字段(音频/字幕)
 * 通过 chip 弹 popover 配置。
 */
import * as React from 'react';
import { ComposerModelPill } from '../composer/ComposerModelPill';
import { VgAspectChip } from './VgAspectChip';
import { VgAutoToggle } from './VgAutoToggle';
import { VgAudioPopover } from './VgAudioPopover';
import { VgSubtitlePopover } from './VgSubtitlePopover';
import { useVgComposer } from './store/vgComposer';

export interface VgComposerToolbarProps {
  autoMode: boolean;
  onAutoModeChange: (v: boolean) => void;
}

export const VgComposerToolbar: React.FC<VgComposerToolbarProps> = ({
  autoMode,
  onAutoModeChange,
}) => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs">
      {/* 模型 — 复用 ChatPage 同款 pill;scope 隔离保证 vg/chat 各自记忆 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">模型</span>
        <ComposerModelPill />
      </div>
      {/* 画幅 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">画幅</span>
        <VgAspectChip />
      </div>
      {/* 语言 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">语言</span>
        <select
          value={params.video_language}
          onChange={(e) => patch({ video_language: e.target.value })}
          className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5"
        >
          <option value="">自动</option>
          <option value="zh-CN">中文</option>
          <option value="en-US">英文</option>
          <option value="ja-JP">日文</option>
        </select>
      </div>
      {/* 段落 */}
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
          className="w-12 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-center"
        />
      </div>
      {/* 音频 / 字幕 — chip 弹 popover */}
      <VgAudioPopover />
      <VgSubtitlePopover />
      {/* 全自动 */}
      <VgAutoToggle autoMode={autoMode} onChange={onAutoModeChange} />
    </div>
  );
};

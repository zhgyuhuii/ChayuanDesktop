/**
 * VgChatPage Composer 正上方的关键配置工具栏 — 5 chip:
 *   画幅 / 语言 / 段落 / 🔊音频 / Aa字幕
 *
 * 注:
 *  - **模型** 已在 ChatComposer 内部 ComposerModelPill 露出,这里不重复
 *  - **全自动** 单独抽到 VgAutoBanner(更显眼的横幅,用户必读)
 */
import * as React from 'react';
import { VgAspectChip } from './VgAspectChip';
import { VgAudioPopover } from './VgAudioPopover';
import { VgSubtitlePopover } from './VgSubtitlePopover';
import { useVgComposer } from './store/vgComposer';

export const VgComposerToolbar: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 py-1.5 text-xs">
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">画幅</span>
        <VgAspectChip />
      </div>
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
      <VgAudioPopover />
      <VgSubtitlePopover />
    </div>
  );
};

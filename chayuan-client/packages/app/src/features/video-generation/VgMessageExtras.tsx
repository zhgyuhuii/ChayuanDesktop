/**
 * 每条 assistant message 下方聚合渲染 — VgChatPage 通过 ConversationView 的
 * extraSlot 传入。
 *
 * 状态:
 *   - vm.taskId && vm.renderState !== 'idle' → RenderProgressCard(任务已提交)
 *   - 否则                                    → 字幕图标 + TtsCard + 去生成按钮
 */
import * as React from 'react';
import { Edit3, Sparkles } from 'lucide-react';
import { TtsCard } from './TtsCard';
import { RenderProgressCard } from './RenderProgressCard';
import { SubtitleEditorDialog } from './SubtitleEditorDialog';
import { MaterialsBgmOutputDialog } from './MaterialsBgmOutputDialog';
import type { ChatMessage } from '../chat/useChayuanChat';

export interface VgMessageExtrasProps {
  message: ChatMessage;
  /** 父级 (VgChatPage) 提供 — 用户改 tts/bgm/cues 时 patch metadata 到 message */
  onMetaChange: (messageId: string, patch: Record<string, unknown>) => void;
  /** 用户点"去生成"后,VgChatPage 调 submitTask + 把 taskId 写回 metadata.taskId */
  onSubmit: (messageId: string) => Promise<void>;
}

export const VgMessageExtras: React.FC<VgMessageExtrasProps> = ({
  message, onMetaChange, onSubmit,
}) => {
  const vm = message.metadata?.videoMeta;
  const [subtitleOpen, setSubtitleOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  if (!vm) return null;

  // 已经有 taskId(用户已提交)→ 渲染进度卡;否则渲染 TTS + 去生成
  if (vm.taskId && vm.renderState && vm.renderState !== 'idle') {
    return (
      <div className="mt-2">
        <RenderProgressCard taskId={vm.taskId} />
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {/* 字幕图标(右上) */}
      <div className="flex justify-end">
        <button type="button" onClick={() => setSubtitleOpen(true)}
          title="编辑字幕"
          className="inline-flex h-7 items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
          <Edit3 className="h-3 w-3" /> 字幕
        </button>
      </div>
      {/* TTS 卡 */}
      {vm.tts && (
        <TtsCard
          tts={vm.tts}
          onChange={(next) => onMetaChange(message.id, { tts: next })}
          previewText={message.content?.slice(0, 50) || ''}
        />
      )}
      {/* 去生成按钮 */}
      <div className="flex justify-end">
        <button type="button" onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 py-1.5 text-sm font-medium text-white shadow">
          <Sparkles className="h-4 w-4" /> 去生成视频
        </button>
      </div>
      {/* 弹窗 */}
      <SubtitleEditorDialog open={subtitleOpen} onOpenChange={setSubtitleOpen} />
      <MaterialsBgmOutputDialog
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onConfirm={async () => {
          setDrawerOpen(false);
          await onSubmit(message.id);
        }}
      />
    </div>
  );
};

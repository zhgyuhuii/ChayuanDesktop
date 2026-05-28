/**
 * 每条 assistant message 下方聚合渲染 — VgChatPage 通过 ConversationView 的
 * extraSlot 传入。
 *
 * 状态:
 *   - vm.taskId && vm.renderState !== 'idle' → RenderProgressCard(任务已提交)
 *   - 否则                                    → 字幕图标 + TtsCard + 去生成按钮
 *
 * NOTE: MaterialsBgmOutputDialog 是 R4.4 才建的整合 Dialog。本 task 用 inline
 * placeholder 占位,R4.4 换成真组件。
 */
import * as React from 'react';
import { Edit3, Sparkles, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@chayuan/ui';
import { TtsCard } from './TtsCard';
import { RenderProgressCard } from './RenderProgressCard';
import { SubtitleEditorDialog } from './SubtitleEditorDialog';
import type { ChatMessage } from '../chat/useChayuanChat';

export interface VgMessageExtrasProps {
  message: ChatMessage;
  /** 父级 (VgChatPage) 提供 — 用户改 tts/bgm/cues 时 patch metadata 到 message */
  onMetaChange: (messageId: string, patch: Record<string, unknown>) => void;
  /** 用户点"去生成"后,VgChatPage 调 submitTask + 把 taskId 写回 metadata.taskId */
  onSubmit: (messageId: string) => Promise<void>;
}

/**
 * R4.4 前的临时占位 — 简单 Dialog,内含"确认"按钮触发 onConfirm。
 * R4.4 会换成 MaterialsBgmOutputDialog(素材 + BGM + 输出 三 section 整合)。
 */
const MaterialsBgmOutputDialogStub: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => Promise<void>;
}> = ({ open, onOpenChange, onConfirm }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="!w-[min(560px,calc(100vw-32px))] !max-w-[560px] gap-0 p-0">
      <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogTitle className="text-base font-semibold">素材 / BGM / 输出(R4.4 完整版待补)</DialogTitle>
        <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]">
          <X className="h-4 w-4" />
        </DialogClose>
      </DialogHeader>
      <div className="space-y-3 p-4 text-xs text-[var(--cy-text-secondary)]">
        <p>占位界面 — R4.4 会替换为 MaterialsSection + BgmSection + OutputSection 整合。</p>
        <p>当前点"确认"即按当前 vgComposer.params 提交渲染任务(走默认 random BGM,
          默认素材源)。</p>
        <button
          type="button"
          onClick={() => { void onConfirm(); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)]"
        >
          确认并提交
        </button>
      </div>
    </DialogContent>
  </Dialog>
);

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
      <MaterialsBgmOutputDialogStub
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

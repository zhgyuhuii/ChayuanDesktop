import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@chayuan/ui';
import type { ChatMessage } from '../../chat/useChayuanChat';

export interface FileSummaryMessageExtrasProps {
  message: ChatMessage;
  onConfirm: (assistantId: string) => void;
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
}

/** 走 ConversationView 的 extraSlot:按 metadata.summary.state 渲染进度/确认/重试。 */
export const FileSummaryMessageExtras: React.FC<FileSummaryMessageExtrasProps> = ({
  message, onConfirm, onCancel, onRetry,
}) => {
  const summary = message.metadata?.summary;
  if (!summary) return null;

  if (summary.state === 'running') {
    // 单条紧凑进度条:行内 loader + 文案 + 细条 + 百分比 + 末尾 X 取消。
    // MessageBubble 已对 metadata.summary 消息跳过通用大进度条,这里是唯一的进度展示。
    const percent = Math.max(0, Math.min(100, message.taskProgress?.percent ?? 0));
    const label = message.taskProgress?.message ?? '正在通览整篇并归纳…';
    return (
      <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--cy-text-secondary)]">
        <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
        <span className="flex-shrink-0 truncate">{label}</span>
        <div className="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--cy-surface-2)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="flex-shrink-0 font-mono text-[var(--cy-text-tertiary)]">{percent}%</span>
        <button
          type="button"
          onClick={() => onCancel(message.id)}
          title="取消总结"
          aria-label="取消总结"
          className="flex-shrink-0 rounded p-0.5 text-[var(--cy-text-tertiary)] transition-colors hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (summary.state === 'needs_confirm') {
    return (
      <div className="mt-1 flex flex-col gap-2 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm">
        <span>
          该文件较大(约 <b>{summary.chunkCount}</b> 块),整篇总结预计约
          <b> {summary.estCalls} </b>次模型调用,可能耗时较久。
        </span>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onConfirm(message.id)}>仍然总结</Button>
          <Button size="sm" variant="outline" onClick={() => onCancel(message.id)}>取消</Button>
        </div>
      </div>
    );
  }

  if (summary.state === 'error') {
    return (
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="text-destructive">总结失败:{summary.msg}</span>
        <Button size="sm" variant="outline" onClick={() => onRetry(message.id)}>重试</Button>
      </div>
    );
  }

  return null; // ok:正文即 message.content,无额外
};

import * as React from 'react';
import { Button } from '@chayuan/ui';
import { TaskProgressPart } from '../../chat/parts/TaskProgressPart';
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
    return (
      <div className="mt-1 flex flex-col gap-1.5">
        {message.taskProgress && (
          <TaskProgressPart
            percent={message.taskProgress.percent}
            message={message.taskProgress.message}
          />
        )}
        <div>
          <Button size="sm" variant="outline" onClick={() => onCancel(message.id)}>取消</Button>
        </div>
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

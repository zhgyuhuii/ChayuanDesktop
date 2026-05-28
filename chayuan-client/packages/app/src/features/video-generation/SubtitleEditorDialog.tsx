/**
 * 字幕编辑器弹窗 — 复用 SubtitleStep 整块,从 chat 消息块右上角图标
 * 弹出。
 *
 * 不走 ArtifactPanel:
 *   - ArtifactPanel kind 限定 code/markdown/mermaid/html/json 五种文本类型,
 *     字幕编辑器是交互组件,塞进去要扩 store + render 分支太多
 *   - Dialog 弹出 + 复用现有 SubtitleStep 组件 100% 代码复用,不污染
 *     全局 artifact history(用户切 task 时旧字幕应该清,artifact 不该残留)
 */
import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@chayuan/ui';
import { X, FileText } from 'lucide-react';
import { SubtitleStep } from './steps/SubtitleStep';

export interface SubtitleEditorDialogProps {
  open: boolean;
  onOpenChange(o: boolean): void;
}

export const SubtitleEditorDialog: React.FC<SubtitleEditorDialogProps> = ({
  open, onOpenChange,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-[min(960px,calc(100vw-32px))] !max-w-[960px] max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0"
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="inline-flex items-center gap-2 text-base font-semibold">
            <FileText className="h-4 w-4" /> 字幕编辑器
          </DialogTitle>
          <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]">
            <X className="h-4 w-4" />
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-4">
          <SubtitleStep />
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * 整合 Dialog — 用户点 "去生成视频" 后弹,三 section 在一个滚动容器内完成最后配置:
 *   素材(在线源 + 本地素材库) / 背景音乐 / 输出(字幕样式 + 渲染参数)
 *
 * 提交按钮回调 onConfirm,父级(VgMessageExtras → VgChatPage)拿当前 message 信息
 * 调 videoGeneration.submitTask。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from '@chayuan/ui';
import { X, Sparkles } from 'lucide-react';
import { MaterialsSection } from './sections/MaterialsSection';
import { BgmSection } from './sections/BgmSection';

export interface MaterialsBgmOutputDialogProps {
  open: boolean;
  onOpenChange(o: boolean): void;
  onConfirm(): void | Promise<void>;
}

export const MaterialsBgmOutputDialog: React.FC<MaterialsBgmOutputDialogProps> = ({
  open, onOpenChange, onConfirm,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="!w-[min(1080px,calc(100vw-32px))] !max-w-[1080px] max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
      <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogTitle className="text-base font-semibold">完成最后配置</DialogTitle>
        <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]">
          <X className="h-4 w-4" />
        </DialogClose>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-4 space-y-6">
        <MaterialsSection />
        <BgmSection />
      </div>
      <DialogFooter className="border-t border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogClose className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]">
          取消
        </DialogClose>
        <button type="button" onClick={() => void onConfirm()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-4 py-1.5 text-sm font-medium text-white shadow">
          <Sparkles className="h-4 w-4" /> 提交生成
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/**
 * 素材选择抽屉 — 复用 MaterialsStep 整块,从 chat "去生成"按钮前弹出。
 *
 * 用户选完素材点"确认"后,VgChatPage 接着调 submitTask 把 video_materials
 * 一并带上。
 */
import * as React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter,
} from '@chayuan/ui';
import { X, Library, Sparkles } from 'lucide-react';
import { MaterialsStep } from './steps/MaterialsStep';
import { useVgComposer } from './store/vgComposer';

export interface MaterialsDrawerProps {
  open: boolean;
  onOpenChange(o: boolean): void;
  /** 用户点"确认"后回调:VgChatPage 接着发起任务 */
  onConfirm?(): void;
}

export const MaterialsDrawer: React.FC<MaterialsDrawerProps> = ({
  open, onOpenChange, onConfirm,
}) => {
  const selectedCount = useVgComposer((s) => (s.params.video_materials ?? []).length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-[min(1080px,calc(100vw-32px))] !max-w-[1080px] max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0"
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="inline-flex items-center gap-2 text-base font-semibold">
            <Library className="h-4 w-4" /> 选择素材
          </DialogTitle>
          <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]">
            <X className="h-4 w-4" />
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-4">
          <MaterialsStep />
          <p className="mt-3 text-xs text-[var(--cy-text-tertiary)]">
            提示:不选任何素材直接确认 → 后端用本地素材库自动挑(或在线源若已配 Pexels/Pixabay Key)
          </p>
        </div>
        <DialogFooter className="border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <span className="mr-auto text-xs text-[var(--cy-text-tertiary)]">
            {selectedCount > 0 ? `已选 ${selectedCount} 段` : '未显式选择(后端自动挑)'}
          </span>
          <DialogClose className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            取消
          </DialogClose>
          <button
            type="button"
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-4 py-1.5 text-sm font-medium text-white shadow"
          >
            <Sparkles className="h-4 w-4" /> 确认并生成
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

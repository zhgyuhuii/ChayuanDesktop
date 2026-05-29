/**
 * 跨端确认框 —— 替代 window.confirm(Tauri webview 禁用原生 confirm,会抛
 * "dialog.confirm not allowed")。
 *
 * 用法:
 *   const ok = await confirmDialog('确认删除?', { danger: true });
 *   if (!ok) return;
 *
 * ConfirmRoot 需在应用根挂一次(跟 ErrorDialogRoot 同处,见 Chrome.tsx)。
 */
import * as React from 'react';
import { create } from 'zustand';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@chayuan/ui';

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  message: string;
  opts: ConfirmOptions;
  resolve: ((ok: boolean) => void) | null;
  ask: (message: string, opts: ConfirmOptions, resolve: (ok: boolean) => void) => void;
  close: (ok: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  message: '',
  opts: {},
  resolve: null,
  ask: (message, opts, resolve) => set({ open: true, message, opts, resolve }),
  close: (ok) => {
    const r = get().resolve;
    set({ open: false, resolve: null });
    if (r) r(ok);
  },
}));

/** 弹确认框,返回用户是否点了确认。 */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmStore.getState().ask(message, opts, resolve);
  });
}

export const ConfirmRoot: React.FC = () => {
  const { open, message, opts, close } = useConfirmStore();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="!w-[min(420px,calc(100vw-32px))] !max-w-[420px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="text-base font-semibold">
            {opts.title || '确认操作'}
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 py-4 text-sm text-[var(--cy-text-secondary)] whitespace-pre-wrap">
          {message}
        </div>
        <DialogFooter className="gap-2 border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]"
          >
            {opts.cancelText || '取消'}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={
              'rounded-lg px-3 py-1.5 text-sm font-medium text-white ' +
              (opts.danger
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-[var(--cy-brand-500)] hover:bg-[var(--cy-brand-600)]')
            }
          >
            {opts.confirmText || '确认'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

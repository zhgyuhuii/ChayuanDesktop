/**
 * 跨端文本输入框 —— 替代 window.prompt(Tauri webview 禁用原生 prompt,返回 null
 * 会让"克隆音色起名"等流程静默中断)。
 *
 * 用法:
 *   const name = await promptDialog('给克隆音色起个名字', { defaultValue: '录音音色' });
 *   if (!name) return;  // 用户取消或留空
 *
 * PromptRoot 需在应用根挂一次(跟 ConfirmRoot 同处,见 Chrome.tsx)。
 */
import * as React from 'react';
import { create } from 'zustand';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@chayuan/ui';

interface PromptOptions {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}

interface PromptState {
  open: boolean;
  message: string;
  opts: PromptOptions;
  resolve: ((v: string | null) => void) | null;
  ask: (message: string, opts: PromptOptions, resolve: (v: string | null) => void) => void;
  close: (v: string | null) => void;
}

const usePromptStore = create<PromptState>((set, get) => ({
  open: false,
  message: '',
  opts: {},
  resolve: null,
  ask: (message, opts, resolve) => set({ open: true, message, opts, resolve }),
  close: (v) => {
    const r = get().resolve;
    set({ open: false, resolve: null });
    if (r) r(v);
  },
}));

/** 弹文本输入框,返回用户输入(取消返 null)。 */
export function promptDialog(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    usePromptStore.getState().ask(message, opts, resolve);
  });
}

export const PromptRoot: React.FC = () => {
  const { open, message, opts, close } = usePromptStore();
  const [val, setVal] = React.useState('');
  // 每次打开重置为 defaultValue
  React.useEffect(() => {
    if (open) setVal(opts.defaultValue ?? '');
  }, [open, opts.defaultValue]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(null); }}>
      <DialogContent className="!w-[min(420px,calc(100vw-32px))] !max-w-[420px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <DialogTitle className="text-base font-semibold">
            {opts.title || '输入'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-4 py-4">
          <span className="text-sm text-[var(--cy-text-secondary)] whitespace-pre-wrap">{message}</span>
          <input
            autoFocus
            type="text"
            value={val}
            placeholder={opts.placeholder}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && val.trim()) close(val); }}
            className="h-9 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
          />
        </div>
        <DialogFooter className="gap-2 border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={() => close(null)}
            className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]"
          >
            {opts.cancelText || '取消'}
          </button>
          <button
            type="button"
            disabled={!val.trim()}
            onClick={() => close(val)}
            className="rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
          >
            {opts.confirmText || '确定'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

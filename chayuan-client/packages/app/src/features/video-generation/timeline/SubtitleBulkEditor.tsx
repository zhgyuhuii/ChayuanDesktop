import * as React from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import type { SrtCue } from './srtParse';

export const SubtitleBulkEditor: React.FC<{
  cues: SrtCue[];
  onSave: (lines: string[]) => void;
  onRegenAudio: (text: string) => void;
  onClose: () => void;
}> = ({ cues, onSave, onRegenAudio, onClose }) => {
  const [text, setText] = React.useState(cues.map((c) => c.text).join('\n'));
  const empty = text.trim().length === 0;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">整体编辑字幕(每行一句)</h3>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]"><X className="h-4 w-4" /></button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
          className="min-h-0 w-full flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-xs leading-relaxed" />
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">行数与原字幕相同则保留各自时间,变了则在总时长内均匀分配。</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" disabled={empty} onClick={() => onSave(text.split('\n'))}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> 保存
          </button>
          <button type="button" disabled={empty} onClick={() => onRegenAudio(text)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" /> 重新生成音频
          </button>
        </div>
      </div>
    </div>
  );
};

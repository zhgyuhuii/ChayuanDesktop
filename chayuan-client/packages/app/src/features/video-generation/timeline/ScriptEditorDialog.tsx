import * as React from 'react';
import { X, Mic, Save, FileText } from 'lucide-react';

/**
 * 手动脚本编辑器(#15):输入/粘贴/编辑旁白脚本,点「合成语音」按当前音频设置
 * 直接合成旁白 + 字幕。纯文本;每行/每句作为旁白文案,合成时由 TTS 切句出字幕。
 */
export const ScriptEditorDialog: React.FC<{
  initial: string;
  onSave: (script: string) => void;
  onSynthesize: (script: string) => void;
  onClose: () => void;
}> = ({ initial, onSave, onSynthesize, onClose }) => {
  const [text, setText] = React.useState(initial);
  const chars = text.trim().length;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="flex max-h-[85vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--cy-border-subtle)] px-4 py-3">
          <FileText className="h-4 w-4 text-[var(--cy-brand-600)]" />
          <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">编辑脚本</h3>
          <span className="text-[11px] text-[var(--cy-text-tertiary)]">输入或粘贴旁白文案,合成时按句切字幕</span>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder="在此输入或粘贴脚本。每句话会作为一段旁白,合成语音时自动切成字幕。"
            className="h-[48vh] w-full resize-none rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3 text-sm leading-relaxed text-[var(--cy-text-primary)] focus:border-[var(--cy-brand-400)] focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]/30"
          />
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--cy-border-subtle)] px-4 py-3">
          <span className="text-[11px] text-[var(--cy-text-tertiary)]">{chars} 字</span>
          <button type="button" onClick={() => { onSave(text); onClose(); }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 py-1.5 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
            <Save className="h-3.5 w-3.5" /> 保存
          </button>
          <button type="button" disabled={chars === 0} onClick={() => { onSynthesize(text); onClose(); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
            <Mic className="h-3.5 w-3.5" /> 合成语音
          </button>
        </div>
      </div>
    </div>
  );
};

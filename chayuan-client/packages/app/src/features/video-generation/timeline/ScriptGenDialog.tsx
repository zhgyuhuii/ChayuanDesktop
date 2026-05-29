import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Sparkles } from 'lucide-react';
import { models, type RawModelItem } from '@chayuan/api';

const LANGS: Array<[string, string]> = [['', '自动'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];

export interface ScriptGenValues {
  subject: string;
  model: string | null;
  paragraph: number;
  language: string;
}

export const ScriptGenDialog: React.FC<{
  initial: ScriptGenValues;
  onSubmit: (v: ScriptGenValues) => void;
  onClose: () => void;
}> = ({ initial, onSubmit, onClose }) => {
  const [subject, setSubject] = React.useState(initial.subject);
  const [model, setModel] = React.useState<string | null>(initial.model);
  const [paragraph, setParagraph] = React.useState(initial.paragraph || 1);
  const [language, setLanguage] = React.useState(initial.language || '');

  const modelsQ = useQuery({ queryKey: ['v1.models'], queryFn: () => models.list(), staleTime: 5 * 60 * 1000 });
  const llm: RawModelItem[] = (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm');
  const groups = React.useMemo<Array<[string, RawModelItem[]]>>(() => {
    const map = new Map<string, RawModelItem[]>();
    for (const m of llm) {
      const k = m.platform_display_name || m.platform_name || '其它';
      const arr = map.get(k);
      if (arr) arr.push(m); else map.set(k, [m]);
    }
    return [...map.entries()];
  }, [llm]);

  const sel = 'h-8 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-[min(480px,92vw)] rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">生成脚本</h3>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]"><X className="h-4 w-4" /></button>
        </div>
        <label className="mb-1 block text-xs text-[var(--cy-text-tertiary)]">主题</label>
        <textarea value={subject} onChange={(e) => setSubject(e.target.value)} rows={3}
          placeholder="描述要生成的视频主题…"
          className="mb-3 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-xs" />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">脚本模型
            <select value={model ?? ''} onChange={(e) => setModel(e.target.value || null)} className={`${sel} min-w-[12em]`}>
              {llm.length === 0 && <option value="">{modelsQ.isLoading ? '加载中…' : '无可用模型'}</option>}
              {groups.map(([plat, ms]) => (
                <optgroup key={plat} label={plat}>
                  {ms.map((m) => { const enc = m.platform_name ? `${m.platform_name}::${m.id}` : m.id; return <option key={enc} value={enc}>{m.id}</option>; })}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">段落
            <select value={paragraph} onChange={(e) => setParagraph(Number(e.target.value))} className={`${sel} w-[4em]`}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">语言
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${sel} w-[7em]`}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <button type="button" disabled={!subject.trim()}
          onClick={() => onSubmit({ subject: subject.trim(), model, paragraph, language })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
          <Sparkles className="h-3.5 w-3.5" /> 生成
        </button>
      </div>
    </div>
  );
};

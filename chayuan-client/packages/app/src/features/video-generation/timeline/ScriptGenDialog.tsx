import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Sparkles, ChevronDown } from 'lucide-react';
import { models, type RawModelItem } from '@chayuan/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@chayuan/ui';
import { ModelMenuList, displayLabel } from '../../composer/ModelMenuList';
import { CHAT_CAPABILITIES } from '../../composer/modelCapabilityChip';
import { useResolveLogo } from '../../catalog/useLogos';

const LANGS: Array<[string, string]> = [['', '自动'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];

export interface ScriptGenValues {
  subject: string;
  model: string | null;
  paragraph: number;
  language: string;
}

/** 脚本模型存为 `platform_name::id`(无 platform 退化成裸 id),与后端路由一致。 */
function encodeModel(m: RawModelItem): string {
  return m.platform_name ? `${m.platform_name}::${m.id}` : m.id;
}
function decodeModel(v: string | null): { platform?: string; id: string } {
  if (!v) return { id: '' };
  const i = v.indexOf('::');
  return i >= 0 ? { platform: v.slice(0, i), id: v.slice(i + 2) } : { id: v };
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
  const [pickOpen, setPickOpen] = React.useState(false);
  const resolveLogo = useResolveLogo();

  const modelsQ = useQuery({ queryKey: ['v1.models'], queryFn: () => models.list(), staleTime: 5 * 60 * 1000 });
  const llm: RawModelItem[] = (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm');

  const cur = decodeModel(model);
  const current = llm.find((m) => m.id === cur.id && (cur.platform ? m.platform_name === cur.platform : true));
  const currentLabel = current ? displayLabel(current) : (cur.id || (modelsQ.isLoading ? '加载中…' : '默认模型'));
  const currentLogo = resolveLogo(current?.platform_name ?? undefined, current?.id);

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
          <div className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">
            脚本模型
            {/* 复用会话里的分组折叠 + 厂商图标模型选择器(ModelMenuList) */}
            <DropdownMenu open={pickOpen} onOpenChange={setPickOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button"
                  className="inline-flex h-8 min-w-[12em] items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
                  title={current?.id || currentLabel}>
                  {currentLogo
                    ? <img src={currentLogo} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
                    : <span className="h-4 w-4 shrink-0 rounded-sm bg-[var(--cy-surface-2)]" />}
                  <span className="max-w-[160px] truncate">{currentLabel}</span>
                  <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12}
                className="z-[260] w-80 overflow-hidden p-0">
                <ModelMenuList
                  models={llm}
                  currentId={cur.id}
                  currentPlatform={cur.platform}
                  allowCapabilities={CHAT_CAPABILITIES}
                  resolveLogo={resolveLogo}
                  emptyLabel={modelsQ.isLoading ? '加载中…' : '无可用模型'}
                  onPick={(m) => { if (m.available === false) return; setModel(encodeModel(m)); setPickOpen(false); }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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

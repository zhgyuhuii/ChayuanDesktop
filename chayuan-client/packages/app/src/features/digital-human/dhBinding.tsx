/**
 * 数字人「绑定来源」UI 辅助 —— P2 UX。
 *
 * 提供:
 *   - BindingHint:标明某个绑定项当前是「跟随预设」还是「本次临时」改过,
 *     以及绑定是否「已失效」(模型被卸 / 知识库被删)。
 *   - dhSourcesToRetrieval:把 /script/generate|from-video 返回的 sources
 *     摊平成统一 RetrievalSource[],交给现成的 <KbResultsView> 渲染。
 */
import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DhScriptSource, RetrievalSource, RetrievalGroup } from '@chayuan/api';

/** 绑定状态:跟随预设 / 本次临时改 / 失效。 */
export type BindingState = 'preset' | 'session' | 'invalid';

/**
 * 判定当前会话值相对预设值的绑定状态。
 *   - invalid 优先(传 invalid=true 时直接 invalid)
 *   - 会话值 == 预设值 → 跟随预设
 *   - 不同 → 本次临时
 * 比较用规整后的字符串(数组按 join),空值统一成 ''。
 */
export function bindingStateOf(presetVal: string, sessionVal: string, invalid = false): BindingState {
  if (invalid) return 'invalid';
  return (presetVal || '') === (sessionVal || '') ? 'preset' : 'session';
}

/** 把 ku_ids 数组规整成可比较字符串(顺序无关)。 */
export function normKuIds(ids?: string[] | null): string {
  return [...(ids ?? [])].map((s) => s.trim()).filter(Boolean).sort().join('');
}

/**
 * BindingHint —— 一行极简标签,放在模型/知识库选择器旁。
 *   preset  → 跟随预设: <name>
 *   session → 本次临时: <name>
 *   invalid → ⚠ 绑定的<noun>已失效,请重新绑定
 */
export const BindingHint: React.FC<{
  state: BindingState;
  /** 当前生效值的展示名(跟随预设/本次临时时显示)。 */
  label?: string;
  /** 失效文案里的名词,如「模型」「知识库」。 */
  noun?: string;
  className?: string;
}> = ({ state, label, noun = '绑定', className }) => {
  if (state === 'invalid') {
    return (
      <span
        className={
          'inline-flex items-center gap-1 text-[11px] text-[var(--cy-danger-500)] ' +
          (className ?? '')
        }
        title={`绑定的${noun}已失效,请重新绑定`}
      >
        <AlertTriangle className="h-3 w-3" />
        {noun}已失效,请重新绑定
      </span>
    );
  }
  const prefix = state === 'preset' ? '跟随预设' : '本次临时';
  return (
    <span
      className={'inline-flex items-center text-[11px] text-[var(--cy-text-tertiary)] ' + (className ?? '')}
      title={label ? `${prefix}: ${label}` : prefix}
    >
      <span className={state === 'session' ? 'text-[var(--cy-brand-600)]' : undefined}>{prefix}</span>
      {label ? <span className="ml-1 max-w-[140px] truncate">: {label}</span> : null}
    </span>
  );
};

const KIND_MAP: Record<string, RetrievalGroup['kind']> = {
  document: 'document',
  structured: 'structured',
  vector: 'vector',
  image: 'image',
  web: 'web',
  file: 'file',
};

/**
 * 把后端文案 sources 摊平成统一 RetrievalSource[]:
 *   - 同一 (kb_name, kind) 聚合成一个 Source
 *   - 每条 source 作为一个 Group(file_name 作标题,snippet 作单段)
 * 没有 kb_name 时归到一个「知识库」兜底 Source。
 */
export function dhSourcesToRetrieval(sources?: DhScriptSource[]): RetrievalSource[] {
  const byKey = new Map<string, RetrievalSource>();
  for (const s of sources ?? []) {
    const kbName = (s.kb_name || '').trim();
    const kind = KIND_MAP[(s.kind || '').trim()] ?? 'document';
    const sourceId = `${kind}:${kbName || '__kb__'}`;
    let src = byKey.get(sourceId);
    if (!src) {
      src = { id: sourceId, label: kbName || '知识库', kind, ok: true, groups: [] };
      byKey.set(sourceId, src);
    }
    const fileName = (s.file_name || '').trim();
    const snippet = (s.snippet || '').trim();
    const groupKey = `${sourceId}/${fileName || src.groups.length}`;
    src.groups.push({
      key: groupKey,
      label: fileName || kbName || '片段',
      kind,
      count: 1,
      ...(kind === 'document' && kbName && fileName
        ? { preview: { kbName, fileName }, download: { kbName, fileName } }
        : {}),
      snippets: snippet ? [{ text: snippet }] : [],
    });
  }
  return [...byKey.values()];
}

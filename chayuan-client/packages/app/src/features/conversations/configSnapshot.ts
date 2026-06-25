/** 会话配置快照:对话流通用,塞进 ConversationRecord.meta(JSON)。 */
export interface ConvConfigSnapshot {
  modelId?: string; platformName?: string;
  mode?: 'plain' | 'kb' | 'agent' | 'skill';
  selectedKuIds?: string[]; selectedKbs?: string[];
  selectedTools?: string[]; selectedMcps?: string[];
  deepThink?: boolean;
  searchMode?: 'precise' | 'balanced' | 'fast';
  rewriteStrategy?: string; embedModelId?: string;
  temperature?: number; maxTokens?: number;
  topK?: number; scoreThreshold?: number; promptName?: string;
  // index signature:让快照可直接当 ConversationRecord.meta(Record<string,unknown>)落库。
  [k: string]: unknown;
}

/** composer 当前 state 的字段子集(只取我们要快照的) */
interface ComposerLike {
  modelId?: string; platformName?: string;
  selectedKuIds?: string[]; selectedKbs?: string[];
  selectedTools?: string[]; selectedMcps?: string[];
  deepThink?: boolean; searchMode?: ConvConfigSnapshot['searchMode'];
  rewriteStrategy?: string; embedModelId?: string;
  temperature?: number; maxTokens?: number;
  topK?: number; scoreThreshold?: number; promptName?: string;
}

/** composer state → 快照(纯函数)。 */
export function snapshotFromComposer(s: ComposerLike): ConvConfigSnapshot {
  return {
    modelId: s.modelId, platformName: s.platformName,
    selectedKuIds: s.selectedKuIds, selectedKbs: s.selectedKbs,
    selectedTools: s.selectedTools, selectedMcps: s.selectedMcps,
    deepThink: s.deepThink, searchMode: s.searchMode,
    rewriteStrategy: s.rewriteStrategy, embedModelId: s.embedModelId,
    temperature: s.temperature, maxTokens: s.maxTokens,
    topK: s.topK, scoreThreshold: s.scoreThreshold, promptName: s.promptName,
  };
}

/**
 * composer store(含 setters)接口子集。
 *
 * 注意:真 composer store **没有** `setDeepThink`,只有 `toggleDeepThink()` +
 * 一个 `deepThink` 当前值。所以 apply 时读 `store.deepThink` 与快照比对,
 * 不一致才 toggle —— 不能直接 set 成目标值。
 */
interface ComposerSetters {
  deepThink?: boolean;
  setModel(id: string, platformName?: string): void;
  setKuIds(ids: string[]): void;
  setKbs(names: string[]): void;
  setTools(ids: string[]): void;
  setMcps(ids: string[]): void;
  setSearchMode(m: NonNullable<ConvConfigSnapshot['searchMode']>): void;
  setRewriteStrategy(s: string): void;
  setEmbedModel(id?: string): void;
  toggleDeepThink(): void;
  setAdvanced(patch: { temperature?: number; maxTokens?: number; topK?: number; scoreThreshold?: number; promptName?: string }): void;
}

/** 快照 → composer(只 set 存在的字段)。 */
export function applySnapshotToComposer(store: ComposerSetters, snap: ConvConfigSnapshot): void {
  if (snap.modelId) store.setModel(snap.modelId, snap.platformName);
  if (snap.selectedKuIds) store.setKuIds(snap.selectedKuIds);
  if (snap.selectedKbs) store.setKbs(snap.selectedKbs);
  if (snap.selectedTools) store.setTools(snap.selectedTools);
  if (snap.selectedMcps) store.setMcps(snap.selectedMcps);
  if (snap.searchMode) store.setSearchMode(snap.searchMode);
  if (snap.rewriteStrategy) store.setRewriteStrategy(snap.rewriteStrategy);
  if (snap.embedModelId !== undefined) store.setEmbedModel(snap.embedModelId);
  // deepThink 只有 toggle:当前值与快照不一致才翻转,一致则跳过。
  if (snap.deepThink !== undefined && !!store.deepThink !== snap.deepThink) {
    store.toggleDeepThink();
  }
  const adv = {
    temperature: snap.temperature, maxTokens: snap.maxTokens,
    topK: snap.topK, scoreThreshold: snap.scoreThreshold, promptName: snap.promptName,
  };
  if (Object.values(adv).some((v) => v !== undefined)) store.setAdvanced(adv);
}

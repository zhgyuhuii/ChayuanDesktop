import { describe, it, expect } from 'vitest';
import { snapshotFromComposer, applySnapshotToComposer, type ConvConfigSnapshot } from '../configSnapshot';

const fullState = {
  modelId: 'p::m1', platformName: 'p',
  selectedKuIds: ['doc:a', 'src:b'], selectedKbs: ['a'],
  selectedTools: ['t1'], selectedMcps: ['mcp1'],
  deepThink: true, searchMode: 'precise' as const,
  rewriteStrategy: 'rewrite' as const, embedModelId: 'e1',
  temperature: 0.7, maxTokens: 2048, topK: 5, scoreThreshold: 0.3, promptName: 'pn',
};

describe('configSnapshot', () => {
  it('snapshotFromComposer 抽取全部状态字段', () => {
    const snap = snapshotFromComposer(fullState as never);
    expect(snap.modelId).toBe('p::m1');
    expect(snap.selectedKuIds).toEqual(['doc:a', 'src:b']);
    expect(snap.deepThink).toBe(true);
    expect(snap.searchMode).toBe('precise');
    expect(snap.temperature).toBe(0.7);
    expect(snap.topK).toBe(5);
  });

  it('applySnapshotToComposer 调用对应 setter(往返一致)', () => {
    const calls: Record<string, unknown> = {};
    // 真 store 没有 setDeepThink,只有 toggleDeepThink + deepThink 当前值;
    // apply 应据当前值与快照比对后 toggle。这里初始 deepThink=false,快照 true → 应 toggle。
    const store = {
      deepThink: false,
      setModel: (id: string, p?: string) => { calls.model = [id, p]; },
      setKuIds: (ids: string[]) => { calls.ku = ids; },
      setKbs: (ids: string[]) => { calls.kbs = ids; },
      setTools: (ids: string[]) => { calls.tools = ids; },
      setMcps: (ids: string[]) => { calls.mcps = ids; },
      setSearchMode: (m: string) => { calls.sm = m; },
      setRewriteStrategy: (s: string) => { calls.rw = s; },
      setEmbedModel: (id?: string) => { calls.embed = id; },
      toggleDeepThink: () => { calls.dt = true; },
      setAdvanced: (p: Record<string, unknown>) => { calls.adv = p; },
    };
    const snap: ConvConfigSnapshot = snapshotFromComposer(fullState as never);
    applySnapshotToComposer(store as never, snap);
    expect(calls.model).toEqual(['p::m1', 'p']);
    expect(calls.ku).toEqual(['doc:a', 'src:b']);
    expect(calls.dt).toBe(true);
    expect(calls.sm).toBe('precise');
    expect((calls.adv as Record<string, unknown>).temperature).toBe(0.7);
  });

  it('applySnapshotToComposer 对空快照不报错(缺字段跳过)', () => {
    const store = {
      deepThink: false,
      setModel() {}, setKuIds() {}, setKbs() {}, setTools() {}, setMcps() {},
      setSearchMode() {}, setRewriteStrategy() {}, setEmbedModel() {}, toggleDeepThink() {}, setAdvanced() {},
    };
    expect(() => applySnapshotToComposer(store as never, {})).not.toThrow();
  });
});

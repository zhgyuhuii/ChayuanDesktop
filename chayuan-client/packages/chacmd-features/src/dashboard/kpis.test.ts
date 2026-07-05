import { describe, expect, it } from 'vitest';
import type { AgentState } from '../stream/streamReducer';
import { computeKpis } from './kpis';

const agent = (nickname: string, status: AgentState['status']): AgentState => ({
  nickname,
  status,
  lastKind: status,
  lastSeq: 0,
});

const stateOf = (...agents: AgentState[]) => ({
  agents: Object.fromEntries(agents.map((a) => [a.nickname, a])),
});

describe('computeKpis', () => {
  it('空态 → 全 0，成功率 0', () => {
    const k = computeKpis(stateOf());
    expect(k).toEqual({
      total: 0,
      running: 0,
      waiting: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      successRate: 0,
    });
  });

  it('按状态计数', () => {
    const k = computeKpis(
      stateOf(
        agent('a', 'running'),
        agent('b', 'running'),
        agent('c', 'waiting'),
        agent('d', 'succeeded'),
        agent('e', 'failed'),
        agent('f', 'interrupted'),
      ),
    );
    expect(k.total).toBe(6);
    expect(k.running).toBe(2);
    expect(k.waiting).toBe(1);
    expect(k.succeeded).toBe(1);
    expect(k.failed).toBe(1);
    expect(k.interrupted).toBe(1);
  });

  it('成功率 = 成功/(成功+失败)', () => {
    const k = computeKpis(
      stateOf(agent('a', 'succeeded'), agent('b', 'succeeded'), agent('c', 'succeeded'), agent('d', 'failed')),
    );
    expect(k.successRate).toBeCloseTo(0.75);
  });

  it('无终态时成功率 0（不 NaN）', () => {
    const k = computeKpis(stateOf(agent('a', 'running'), agent('b', 'waiting')));
    expect(k.successRate).toBe(0);
  });
});

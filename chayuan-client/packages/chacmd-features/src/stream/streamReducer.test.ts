import { describe, expect, it } from 'vitest';
import { type CommandState, applyStreamEvent, initialCommandState } from './streamReducer';

const ev = (kind: string, container: string, seq: number, payload: Record<string, unknown> = {}) => ({
  kind,
  container,
  job_id: 'j1',
  seq,
  payload,
});

describe('applyStreamEvent', () => {
  it('started → 员工上线 running', () => {
    const s = applyStreamEvent(initialCommandState, ev('started', 'dev', 0));
    expect(s.agents.dev?.status).toBe('running');
    expect(s.agents.dev?.nickname).toBe('dev');
    expect(s.agents.dev?.jobId).toBe('j1');
  });

  it('progress → 保持 running + 记录最新步骤/emoji', () => {
    let s = applyStreamEvent(initialCommandState, ev('started', 'dev', 0));
    s = applyStreamEvent(s, ev('progress', 'dev', 1, { command: 'ls', emoji: '🛠️' }));
    expect(s.agents.dev?.status).toBe('running');
    expect(s.agents.dev?.lastSeq).toBe(1);
    expect(s.agents.dev?.emoji).toBe('🛠️');
  });

  it('succeeded/failed/interrupted → 终态', () => {
    let s = applyStreamEvent(initialCommandState, ev('started', 'dev', 0));
    s = applyStreamEvent(s, ev('succeeded', 'dev', 2));
    expect(s.agents.dev?.status).toBe('succeeded');
    const f = applyStreamEvent(applyStreamEvent(initialCommandState, ev('started', 'x', 0)), ev('failed', 'x', 1));
    expect(f.agents.x?.status).toBe('failed');
  });

  it('pending_approval → waiting(需人在环)', () => {
    let s = applyStreamEvent(initialCommandState, ev('started', 'dev', 0));
    s = applyStreamEvent(s, ev('pending_approval', 'dev', 1));
    expect(s.agents.dev?.status).toBe('waiting');
  });

  it('多员工独立累积', () => {
    let s: CommandState = initialCommandState;
    s = applyStreamEvent(s, ev('started', 'a', 0));
    s = applyStreamEvent(s, ev('started', 'b', 0));
    expect(Object.keys(s.agents).sort()).toEqual(['a', 'b']);
  });

  it('不修改入参(纯函数)', () => {
    const s0 = initialCommandState;
    applyStreamEvent(s0, ev('started', 'dev', 0));
    expect(s0.agents).toEqual({});
  });

  it('未知 container 的 progress 也建员工(容错)', () => {
    const s = applyStreamEvent(initialCommandState, ev('progress', 'ghost', 5, {}));
    expect(s.agents.ghost).toBeDefined();
    expect(s.agents.ghost?.status).toBe('running');
  });
});

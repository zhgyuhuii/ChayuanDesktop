import { describe, expect, it } from 'vitest';
import { type TaskEdge, type TaskNode, toFlowGraph } from './flowModel';

const N = (id: string, label = id): TaskNode => ({ id, label });

describe('toFlowGraph', () => {
  it('串行链 → 逐层递增 y', () => {
    const nodes: TaskNode[] = [N('a'), N('b'), N('c')];
    const edges: TaskEdge[] = [
      { src: 'a', dst: 'b' },
      { src: 'b', dst: 'c' },
    ];
    const g = toFlowGraph(nodes, edges, {});
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.position.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('c'));
    expect(g.edges).toHaveLength(2);
  });

  it('扇出 → 同层不同 x', () => {
    const g = toFlowGraph([N('a'), N('b'), N('c')], [
      { src: 'a', dst: 'b' },
      { src: 'a', dst: 'c' },
    ], {});
    const b = g.nodes.find((n) => n.id === 'b')!;
    const c = g.nodes.find((n) => n.id === 'c')!;
    expect(b.position.y).toBe(c.position.y); // 同层
    expect(b.position.x).not.toBe(c.position.x); // 不同列
  });

  it('状态映射到节点颜色', () => {
    const g = toFlowGraph([N('a')], [], { a: 'running' });
    const a = g.nodes.find((n) => n.id === 'a')!;
    expect(a.data.status).toBe('running');
    expect(a.data.color).toBe('#3b82f6');
  });

  it('无状态默认 pending', () => {
    const g = toFlowGraph([N('a')], [], {});
    expect(g.nodes[0]?.data.status).toBe('pending');
  });

  it('handoff 边高亮，loop 边虚线动画', () => {
    const g = toFlowGraph([N('a'), N('b'), N('r')], [
      { src: 'a', dst: 'b', kind: 'handoff' },
      { src: 'r', dst: 'a', kind: 'loop' },
    ], {});
    const handoff = g.edges.find((e) => e.source === 'a' && e.target === 'b')!;
    const loop = g.edges.find((e) => e.source === 'r' && e.target === 'a')!;
    expect(handoff.label).toBe('handoff');
    expect(loop.animated).toBe(true);
  });

  it('loop 边不参与分层（不制造环）', () => {
    // a→b→r，r→a(loop)：仍应分 3 层，不因回环崩溃
    const g = toFlowGraph([N('a'), N('b'), N('r')], [
      { src: 'a', dst: 'b' },
      { src: 'b', dst: 'r' },
      { src: 'r', dst: 'a', kind: 'loop' },
    ], {});
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.position.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('r'));
  });
});

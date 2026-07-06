/**
 * L1 任务编排视图数据模型（纯逻辑）：把任务 DAG + 各节点状态映射成 reactflow 图。
 * Supervisor 中心 + 并行分支的分层布局；handoff/loop 边区分画法（§3.2）。
 * 不 import reactflow 运行时（保持 node/测试环境可跑）；输出结构与 reactflow Node/Edge 兼容。
 */

export type TaskLifecycle =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export interface TaskNode {
  id: string;
  label: string;
  role?: string;
}

export interface TaskEdge {
  src: string;
  dst: string;
  kind?: 'depends' | 'handoff' | 'loop';
}

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string; status: TaskLifecycle; role?: string; color: string };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  label?: string;
  style?: Record<string, unknown>;
}

const STATUS_COLOR: Record<TaskLifecycle, string> = {
  pending: '#64748b',
  running: '#3b82f6',
  waiting: '#f59e0b',
  succeeded: '#22c55e',
  failed: '#ef4444',
  skipped: '#475569',
};

const COL = 220;
const ROW = 140;

/** 分层：节点 rank = 最长非回环前驱链长度（loop 边不计，避免成环）。 */
function computeRanks(nodes: TaskNode[], edges: TaskEdge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const n of nodes) preds.set(n.id, []);
  for (const e of edges) {
    if (e.kind === 'loop') continue;
    preds.get(e.dst)?.push(e.src);
  }
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // 防御性：意外环
    visiting.add(id);
    const ps = preds.get(id) ?? [];
    const r = ps.length === 0 ? 0 : 1 + Math.max(...ps.map(of));
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const n of nodes) of(n.id);
  return rank;
}

export function toFlowGraph(
  nodes: TaskNode[],
  edges: TaskEdge[],
  statuses: Record<string, TaskLifecycle>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const ranks = computeRanks(nodes, edges);
  const colByRank = new Map<number, number>();

  const flowNodes: FlowNode[] = nodes.map((n) => {
    const r = ranks.get(n.id) ?? 0;
    const col = colByRank.get(r) ?? 0;
    colByRank.set(r, col + 1);
    const status = statuses[n.id] ?? 'pending';
    return {
      id: n.id,
      position: { x: col * COL, y: r * ROW },
      data: { label: n.label, status, role: n.role, color: STATUS_COLOR[status] },
    };
  });

  const flowEdges: FlowEdge[] = edges.map((e, i) => {
    const isLoop = e.kind === 'loop';
    const isHandoff = e.kind === 'handoff';
    return {
      id: `e${i}-${e.src}-${e.dst}`,
      source: e.src,
      target: e.dst,
      animated: isLoop,
      label: isHandoff ? 'handoff' : undefined,
      style: isLoop ? { strokeDasharray: '6 4' } : undefined,
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export { STATUS_COLOR as TASK_STATUS_COLOR };

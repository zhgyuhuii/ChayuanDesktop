import type { AgentLifecycle, CommandState } from '../stream/streamReducer';

/** 顶栏 KPI（§7 验收：在线/运行/待审批/失败/成功率实时刷新）。 */
export interface DashboardKpis {
  total: number;
  running: number;
  waiting: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  /** 成功率 = 成功 /(成功+失败)，无终态时 0（不 NaN）。 */
  successRate: number;
}

/** 纯派生：从指挥态算出顶栏 KPI。 */
export function computeKpis(state: CommandState): DashboardKpis {
  const counts: Record<AgentLifecycle, number> = {
    running: 0,
    waiting: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
  };
  for (const agent of Object.values(state.agents)) {
    counts[agent.status] += 1;
  }
  const total = Object.values(state.agents).length;
  const terminal = counts.succeeded + counts.failed;
  const successRate = terminal === 0 ? 0 : counts.succeeded / terminal;
  return {
    total,
    running: counts.running,
    waiting: counts.waiting,
    succeeded: counts.succeeded,
    failed: counts.failed,
    interrupted: counts.interrupted,
    successRate,
  };
}

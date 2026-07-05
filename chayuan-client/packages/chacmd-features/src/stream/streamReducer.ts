/**
 * ChaCMD 指挥大屏 SSE 流 reducer（纯函数）。
 * 把后端 GET /api/v1/stream 的事件（EventStreamHub 广播的统一事件）累积成
 * "员工（数字员工/容器）态"，供 L0 星群/2D 栅格渲染。
 */

export type AgentLifecycle = 'running' | 'waiting' | 'succeeded' | 'failed' | 'interrupted';

export interface AgentState {
  nickname: string;
  status: AgentLifecycle;
  jobId?: string;
  lastKind: string;
  lastSeq: number;
  /** 头顶 emoji 气泡（Smallville 手法）：显示"正在干嘛" */
  emoji?: string;
}

export interface CommandState {
  agents: Record<string, AgentState>;
}

export const initialCommandState: CommandState = { agents: {} };

/** 后端 SSE 事件（EventIngest 广播的 msg 形状）。 */
export interface StreamEvent {
  kind: string;
  container: string;
  job_id?: string;
  seq: number;
  payload?: Record<string, unknown>;
}

const _TERMINAL: Record<string, AgentLifecycle> = {
  succeeded: 'succeeded',
  failed: 'failed',
  interrupted: 'interrupted',
};

/** 由事件 kind 推导员工生命周期态。 */
function statusFor(kind: string): AgentLifecycle {
  const terminal = _TERMINAL[kind];
  if (terminal) return terminal;
  if (kind === 'pending_approval') return 'waiting';
  // started / progress / 其它 → 视为在跑
  return 'running';
}

/** 纯函数：把一个 SSE 事件应用到指挥态，返回新态（不改入参）。 */
export function applyStreamEvent(state: CommandState, event: StreamEvent): CommandState {
  const nickname = event.container;
  const prev = state.agents[nickname];
  const emoji =
    typeof event.payload?.emoji === 'string' ? (event.payload.emoji as string) : prev?.emoji;
  const next: AgentState = {
    nickname,
    status: statusFor(event.kind),
    jobId: event.job_id ?? prev?.jobId,
    lastKind: event.kind,
    lastSeq: event.seq,
    emoji,
  };
  return { agents: { ...state.agents, [nickname]: next } };
}

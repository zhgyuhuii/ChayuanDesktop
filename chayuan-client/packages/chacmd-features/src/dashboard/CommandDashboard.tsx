import * as React from 'react';
import type { AgentLifecycle, AgentState } from '../stream/streamReducer';
import { useCommandStream } from '../stream/useCommandStream';

/** 生命周期 → 状态灯色（避免二元红绿灯，用多态色，§10.1-D 告警纪律）。 */
const STATUS_COLOR: Record<AgentLifecycle, string> = {
  running: '#3b82f6', // 蓝：在跑
  waiting: '#f59e0b', // 琥珀：等人在环
  succeeded: '#22c55e', // 绿：完成
  failed: '#ef4444', // 红：失败
  interrupted: '#a855f7', // 紫：中断
};

const STATUS_LABEL: Record<AgentLifecycle, string> = {
  running: '进行中',
  waiting: '待审批',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
};

const AgentCard: React.FC<{ agent: AgentState }> = ({ agent }) => (
  <div
    data-testid={`agent-${agent.nickname}`}
    style={{
      border: `1px solid ${STATUS_COLOR[agent.status]}`,
      borderRadius: 12,
      padding: 16,
      minWidth: 180,
      background: 'rgba(255,255,255,0.03)',
      color: '#e5e7eb',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: STATUS_COLOR[agent.status],
          boxShadow: `0 0 8px ${STATUS_COLOR[agent.status]}`,
        }}
      />
      <strong>{agent.nickname}</strong>
      {agent.emoji ? <span title="正在干嘛">{agent.emoji}</span> : null}
    </div>
    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
      {STATUS_LABEL[agent.status]} · step #{agent.lastSeq}
    </div>
  </div>
);

/**
 * ChaCMD 指挥大屏 L0（v1）：数字员工节点栅格 + 状态灯 + 头顶 emoji。
 * 实时数据经 useCommandStream 消费后端 SSE。3D 星群皮肤（3d-force-graph）见 StarfieldL0（Task 5）。
 */
export const CommandDashboard: React.FC<{ streamUrl?: string }> = ({ streamUrl }) => {
  const state = useCommandStream(streamUrl);
  const agents = Object.values(state.agents);

  return (
    <div
      data-testid="command-dashboard"
      style={{ width: '100%', height: '100%', padding: 24, background: '#0b1020', overflow: 'auto' }}
    >
      <h1 style={{ color: '#e5e7eb', fontSize: 20, marginBottom: 4 }}>ChaCMD 指挥大屏</h1>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
        在线数字员工：{agents.length}
      </div>
      {agents.length === 0 ? (
        <div style={{ color: '#64748b' }}>暂无在线员工（等待事件流…）</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {agents.map((a) => (
            <AgentCard key={a.nickname} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
};

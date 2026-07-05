import * as React from 'react';
import type { AgentLifecycle, AgentState } from '../stream/streamReducer';

const STATUS_COLOR: Record<AgentLifecycle, string> = {
  running: '#3b82f6',
  waiting: '#f59e0b',
  succeeded: '#22c55e',
  failed: '#ef4444',
  interrupted: '#a855f7',
};

const STATUS_LABEL: Record<AgentLifecycle, string> = {
  running: '进行中（using tool）',
  waiting: '待审批（waiting）',
  succeeded: '已完成（done）',
  failed: '失败（stuck）',
  interrupted: '已中断',
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.8 }}>
    <span style={{ color: '#64748b', minWidth: 76 }}>{label}</span>
    <span style={{ color: '#cbd5e1' }}>{children}</span>
  </div>
);

const ActionButton: React.FC<{ label: string; hint: string }> = ({ label, hint }) => (
  <button
    type="button"
    disabled
    title={hint}
    style={{
      padding: '6px 10px',
      fontSize: 12,
      color: '#64748b',
      background: 'rgba(148,163,184,0.08)',
      border: '1px solid rgba(148,163,184,0.2)',
      borderRadius: 8,
      cursor: 'not-allowed',
    }}
  >
    {label}
  </button>
);

/**
 * 数字员工卡（§3.1）。点节点弹出。
 * v1 渲染事件流现有字段（身份/状态/当前步/emoji）；richer 字段（goal/owner/token/cost/技能）
 * 待后端事件补齐，此处标注"待后端"，动作按钮 v1 占位 disabled（免密开桌面#8/编辑契约#18/查trace）。
 */
export const AgentCard: React.FC<{ agent: AgentState; onClose: () => void }> = ({ agent, onClose }) => (
  <div
    data-testid={`agent-card-${agent.nickname}`}
    style={{
      width: 320,
      background: 'rgba(15,23,42,0.94)',
      border: `1px solid ${STATUS_COLOR[agent.status]}`,
      borderRadius: 16,
      padding: 20,
      color: '#e5e7eb',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: STATUS_COLOR[agent.status],
            boxShadow: `0 0 10px ${STATUS_COLOR[agent.status]}`,
          }}
        />
        <strong style={{ fontSize: 17 }}>{agent.nickname}</strong>
        {agent.emoji ? <span style={{ fontSize: 18 }}>{agent.emoji}</span> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer' }}
      >
        ×
      </button>
    </div>

    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Row label="状态">{STATUS_LABEL[agent.status]}</Row>
      <Row label="当前步">#{agent.lastSeq} · {agent.lastKind}</Row>
      <Row label="任务">{agent.jobId ?? '—'}</Row>
      <Row label="工位">{agent.nickname}（容器）</Row>
      <Row label="角色/目标">
        <span style={{ color: '#64748b' }}>待后端事件补齐</span>
      </Row>
      <Row label="观测">
        <span style={{ color: '#64748b' }}>token/成本待后端</span>
      </Row>
    </div>

    <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
      <ActionButton label="免密开桌面" hint="#8 KasmVNC iframe（v3）" />
      <ActionButton label="编辑角色契约" hint="#18 Charter（v2）" />
      <ActionButton label="查 trace" hint="OTel 日志（待接）" />
    </div>
  </div>
);

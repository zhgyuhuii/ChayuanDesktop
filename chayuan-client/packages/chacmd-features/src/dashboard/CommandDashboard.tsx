import * as React from 'react';
import type { AgentLifecycle, AgentState } from '../stream/streamReducer';
import { useCommandStream } from '../stream/useCommandStream';
import { AgentCard } from './AgentCard';
import { KpiBar } from './KpiBar';
import { computeKpis } from './kpis';

/** 生命周期 → 状态灯色（避免二元红绿灯，用多态色，§2.2 告警纪律）。 */
const STATUS_COLOR: Record<AgentLifecycle, string> = {
  running: '#3b82f6',
  waiting: '#f59e0b',
  succeeded: '#22c55e',
  failed: '#ef4444',
  interrupted: '#a855f7',
};

const STATUS_LABEL: Record<AgentLifecycle, string> = {
  running: '进行中',
  waiting: '待审批',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
};

// 3D 星群皮肤只在浏览器/webview 运行且体积大（three），用 React.lazy 延迟：
// node/测试环境永不加载，2D 栅格作 Suspense 兜底 + 无 WebGL 时的降级视图。
const StarfieldL0 = React.lazy(() =>
  import('./StarfieldL0').then((m) => ({ default: m.StarfieldL0 })),
);

const AgentTile: React.FC<{ agent: AgentState; onSelect?: (id: string) => void }> = ({ agent, onSelect }) => (
  <button
    type="button"
    data-testid={`agent-${agent.nickname}`}
    onClick={() => onSelect?.(agent.nickname)}
    style={{
      textAlign: 'left',
      border: `1px solid ${STATUS_COLOR[agent.status]}`,
      borderRadius: 12,
      padding: 16,
      minWidth: 180,
      background: 'rgba(255,255,255,0.03)',
      color: '#e5e7eb',
      cursor: 'pointer',
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
  </button>
);

/** 2D 员工节点栅格（降级视图 / 3D 加载兜底）。 */
export const AgentGrid: React.FC<{ agents: AgentState[]; onSelect?: (id: string) => void }> = ({ agents, onSelect }) => {
  if (agents.length === 0) {
    return <div style={{ color: '#64748b', padding: 24 }}>暂无在线员工（等待事件流…）</div>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 24 }}>
      {agents.map((a) => (
        <AgentTile key={a.nickname} agent={a} onSelect={onSelect} />
      ))}
    </div>
  );
};

export type DashboardMode = 'cockpit' | 'kiosk';

function initialMode(): DashboardMode {
  if (typeof window !== 'undefined' && window.location?.search) {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('mode') === 'kiosk') return 'kiosk';
  }
  return 'cockpit';
}

/**
 * ChaCMD 指挥大屏 L0（v1）：数字员工星群 + 顶栏 KPI + 点节点弹员工卡 + 驾驶舱/投墙双模式。
 * 实时数据经 useCommandStream 消费后端 SSE(/api/v1/stream)。
 * 主视图 = 3D 星群（StarfieldL0，需 GPU）；2D 栅格作 Suspense 兜底与降级。
 * - 驾驶舱模式（默认）：星群 + 顶栏 KPI + 选中员工卡侧板（§2.4；对话框并入见 v2）。
 * - 投墙 kiosk 模式：L0 满屏、KPI 放大居中、隐侧板（开机自启进此模式，`?mode=kiosk`）。
 */
export const CommandDashboard: React.FC<{ streamUrl?: string }> = ({ streamUrl }) => {
  const state = useCommandStream(streamUrl);
  const agents = Object.values(state.agents);
  const kpis = React.useMemo(() => computeKpis(state), [state]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<DashboardMode>(initialMode);

  const selectedAgent = selected ? state.agents[selected] : undefined;
  const isKiosk = mode === 'kiosk';

  return (
    <div
      data-testid="command-dashboard"
      data-mode={mode}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#0b1020', overflow: 'hidden' }}
    >
      {/* 顶栏：标题 + KPI（kiosk 放大居中） */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: isKiosk ? '24px 32px' : '16px 24px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: isKiosk ? 'center' : 'space-between',
          gap: 24,
          zIndex: 2,
        }}
      >
        {!isKiosk && (
          <div style={{ pointerEvents: 'none' }}>
            <h1 style={{ color: '#e5e7eb', fontSize: 20, margin: 0 }}>ChaCMD 指挥大屏</h1>
            <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>在线数字员工：{agents.length}</div>
          </div>
        )}
        <KpiBar kpis={kpis} big={isKiosk} />
        <button
          type="button"
          onClick={() => setMode(isKiosk ? 'cockpit' : 'kiosk')}
          title={isKiosk ? '退出投墙，回驾驶舱' : '进入投墙只读模式'}
          style={{
            position: isKiosk ? 'absolute' : 'static',
            top: 24,
            right: 32,
            padding: '8px 12px',
            fontSize: 12,
            color: '#cbd5e1',
            background: 'rgba(148,163,184,0.1)',
            border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: 8,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {isKiosk ? '🖥️ 驾驶舱' : '📺 投墙'}
        </button>
      </div>

      {/* L0 星群主视图 */}
      <React.Suspense fallback={<AgentGrid agents={agents} onSelect={setSelected} />}>
        <StarfieldL0 agents={agents} onSelect={setSelected} />
      </React.Suspense>

      {/* 选中员工卡侧板（仅驾驶舱模式） */}
      {!isKiosk && selectedAgent ? (
        <div style={{ position: 'absolute', top: 84, right: 24, zIndex: 3 }}>
          <AgentCard agent={selectedAgent} onClose={() => setSelected(null)} />
        </div>
      ) : null}
    </div>
  );
};

import * as React from 'react';
import type { AgentState } from '../stream/streamReducer';
import { ActivityTimeline, type TimelineStep } from '../task/ActivityTimeline';

/** 员工产出物条目。 */
export interface Artifact {
  name: string;
  ref: string;
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  running: '工作中',
  waiting: '待审批',
  succeeded: '已完成',
  failed: '遇阻',
  interrupted: '已中断',
};

/**
 * 员工视图（§10.3 / §6.18-G4）：员工登录默认落此页，看到自己的状态 / 成果 / 工作记录。
 * 与指挥官的 L2 下钻不同——这是容器常驻员工的自视角。
 */
export const EmployeeView: React.FC<{
  agent: AgentState;
  artifacts?: Artifact[];
  log?: TimelineStep[];
}> = ({ agent, artifacts = [], log = [] }) => (
  <div data-testid="employee-view" style={{ padding: 24, color: '#e5e7eb', background: '#0b1020', minHeight: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>{agent.nickname}</h1>
      {agent.emoji ? <span style={{ fontSize: 20 }}>{agent.emoji}</span> : null}
      <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 13 }}>
        {STATUS_LABEL[agent.status]} · step #{agent.lastSeq}
      </span>
    </div>

    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>成果</h2>
      {artifacts.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>暂无产出物</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {artifacts.map((a) => (
            <li key={a.ref} style={{ padding: '4px 0' }}>
              <a href={a.ref} style={{ color: '#38bdf8', fontSize: 13 }}>
                {a.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>

    <section>
      <h2 style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>工作记录</h2>
      {log.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>暂无记录</div>
      ) : (
        <ActivityTimeline steps={log} currentSeq={agent.lastSeq} />
      )}
    </section>
  </div>
);

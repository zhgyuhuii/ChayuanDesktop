import * as React from 'react';
import type { TaskLifecycle } from '../orchestration/flowModel';

/** 活动时间线一步（§3.2 黄金组件）：时序 + 钉住"当前步" + 跳到产物链接。 */
export interface TimelineStep {
  seq: number;
  actor: string; // 发言人/执行者昵称（统一消息流带发言人标识）
  text: string;
  status: TaskLifecycle;
  artifactRef?: string; // "跳到产物"链接
}

const DOT: Record<TaskLifecycle, string> = {
  pending: '#64748b',
  running: '#3b82f6',
  waiting: '#f59e0b',
  succeeded: '#22c55e',
  failed: '#ef4444',
  skipped: '#475569',
};

export const ActivityTimeline: React.FC<{ steps: TimelineStep[]; currentSeq?: number }> = ({
  steps,
  currentSeq,
}) => (
  <div data-testid="activity-timeline" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    {steps.map((s) => {
      const pinned = s.seq === currentSeq;
      return (
        <div
          key={s.seq}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            padding: '6px 10px',
            borderLeft: `2px solid ${DOT[s.status]}`,
            background: pinned ? 'rgba(59,130,246,0.12)' : 'transparent',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DOT[s.status], flex: '0 0 auto' }} />
          <span style={{ color: '#94a3b8', fontSize: 11, minWidth: 64 }}>@{s.actor}</span>
          <span style={{ color: '#e5e7eb', fontSize: 13, flex: 1 }}>
            {pinned ? <strong>{s.text}</strong> : s.text}
          </span>
          {s.artifactRef ? (
            <a href={s.artifactRef} style={{ color: '#38bdf8', fontSize: 12 }}>
              跳到产物
            </a>
          ) : null}
        </div>
      );
    })}
  </div>
);

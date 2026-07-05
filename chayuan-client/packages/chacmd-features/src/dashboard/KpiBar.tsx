import * as React from 'react';
import type { DashboardKpis } from './kpis';

interface Stat {
  key: keyof DashboardKpis;
  label: string;
  color: string;
}

// 与状态灯色一致（§2.2 状态别用二元红绿灯，多态色）。
const STATS: Stat[] = [
  { key: 'total', label: '在线员工', color: '#e5e7eb' },
  { key: 'running', label: '进行中', color: '#3b82f6' },
  { key: 'waiting', label: '待审批', color: '#f59e0b' },
  { key: 'succeeded', label: '已完成', color: '#22c55e' },
  { key: 'failed', label: '失败', color: '#ef4444' },
  { key: 'interrupted', label: '已中断', color: '#a855f7' },
];

const Tile: React.FC<{ label: string; value: React.ReactNode; color: string; big?: boolean }> = ({
  label,
  value,
  color,
  big,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', minWidth: big ? 96 : 72 }}>
    <span style={{ color, fontSize: big ? 34 : 24, fontWeight: 700, lineHeight: 1.1 }}>{value}</span>
    <span style={{ color: '#94a3b8', fontSize: big ? 13 : 11, marginTop: 2 }}>{label}</span>
  </div>
);

/** 顶栏 KPI 条（§7 实时刷新；kiosk 模式放大）。 */
export const KpiBar: React.FC<{ kpis: DashboardKpis; big?: boolean }> = ({ kpis, big }) => (
  <div
    data-testid="kpi-bar"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: big ? 40 : 28,
      padding: big ? '18px 32px' : '12px 24px',
      background: 'rgba(11,16,32,0.72)',
      borderRadius: 14,
      backdropFilter: 'blur(6px)',
    }}
  >
    {STATS.map((s) => (
      <Tile key={s.key} label={s.label} value={kpis[s.key]} color={s.color} big={big} />
    ))}
    <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(148,163,184,0.25)' }} />
    <Tile
      label="成功率"
      value={`${Math.round(kpis.successRate * 100)}%`}
      color={kpis.successRate >= 0.8 ? '#22c55e' : kpis.successRate >= 0.5 ? '#f59e0b' : '#ef4444'}
      big={big}
    />
  </div>
);

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminUsersSnapshot, type UsersSnapshot } from '@chayuan/api';
import { AdminChart } from './AdminChart';

const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-semibold">{value}</div>
  </div>
);

export const UsersHero: React.FC = () => {
  const q = useQuery<UsersSnapshot>({ queryKey: ['admin', 'users', 'snapshot'], queryFn: adminUsersSnapshot, staleTime: 30_000 });
  const s = q.data;
  if (!s) return null;
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['消息量', '日活'] },
    xAxis: { type: 'category', data: s.daily_msg.map((d) => d.date) },
    yAxis: [{ type: 'value', name: '消息' }, { type: 'value', name: '日活' }],
    series: [
      { name: '消息量', type: 'bar', data: s.daily_msg.map((d) => d.count) },
      { name: '日活', type: 'line', yAxisIndex: 1, data: s.daily_active.map((d) => d.active_users) },
    ],
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="总用户" value={String(s.total_users)} />
        <Kpi label="近7日活跃" value={String(s.active_7d)} />
        <Kpi label="总消息" value={String(s.total_messages)} />
        <Kpi label="估算 tokens" value={String(s.total_tokens)} />
      </div>
      <div className="rounded-xl border p-2">
        <div className="px-2 py-1 text-sm font-medium">近 30 日消息量与日活</div>
        <AdminChart option={option} />
      </div>
    </div>
  );
};

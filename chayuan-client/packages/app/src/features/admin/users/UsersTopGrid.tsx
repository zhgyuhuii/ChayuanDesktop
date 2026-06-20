import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminUsersSnapshot, type UsersSnapshot, type NameCount } from '@chayuan/api';
import { AdminChart } from './AdminChart';

const barOption = (rows: Array<{ name: string; value: number }>) => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 90, right: 16, top: 10, bottom: 20 },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: rows.map((r) => r.name).reverse() },
  series: [{ type: 'bar', data: rows.map((r) => r.value).reverse() }],
});

const Card: React.FC<{ title: string; option: Record<string, unknown> }> = ({ title, option }) => (
  <div className="rounded-xl border p-2">
    <div className="px-2 py-1 text-sm font-medium">{title}</div>
    <AdminChart option={option} height={240} />
  </div>
);

export const UsersTopGrid: React.FC = () => {
  const q = useQuery<UsersSnapshot>({ queryKey: ['admin', 'users', 'snapshot'], queryFn: adminUsersSnapshot, staleTime: 30_000 });
  const s = q.data;
  if (!s) return null;
  const topUsersTokens = [...s.users].filter((u) => u.est_tokens > 0).slice(0, 10).map((u) => ({ name: u.username, value: u.est_tokens }));
  const topUsersMsg = [...s.users].sort((a, b) => b.msg_count - a.msg_count).filter((u) => u.msg_count > 0).slice(0, 10).map((u) => ({ name: u.username, value: u.msg_count }));
  const nc = (arr: NameCount[]) => arr.map((d) => ({ name: d.name, value: d.count }));
  const donut = {
    tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['40%', '70%'], data: nc(s.top_chat_type) }],
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card title="Top10 用户·tokens" option={barOption(topUsersTokens)} />
      <Card title="Top10 用户·消息数" option={barOption(topUsersMsg)} />
      <Card title="Top10 模型使用" option={barOption(nc(s.top_model))} />
      <Card title="Top10 工具使用" option={barOption(nc(s.top_tool))} />
      <Card title="Top10 知识库使用" option={barOption(nc(s.top_kb))} />
      <Card title="对话类型分布" option={donut} />
    </div>
  );
};

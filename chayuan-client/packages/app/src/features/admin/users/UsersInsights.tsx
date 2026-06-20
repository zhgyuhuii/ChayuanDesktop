import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminUsersSnapshot, type UsersSnapshot } from '@chayuan/api';
import { AdminChart } from './AdminChart';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i));

const heatOption = (matrix: number[][], maxV: number) => {
  const data: Array<[number, number, number]> = [];
  matrix.forEach((row, d) => row.forEach((v, h) => data.push([h, d, v])));
  return {
    tooltip: { position: 'top' },
    grid: { left: 50, right: 16, top: 10, bottom: 24 },
    xAxis: { type: 'category', data: HOURS },
    yAxis: { type: 'category', data: DAYS },
    visualMap: { min: 0, max: Math.max(1, maxV), calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
    series: [{ type: 'heatmap', data }],
  };
};

export const UsersInsights: React.FC = () => {
  const q = useQuery<UsersSnapshot>({ queryKey: ['admin', 'users', 'snapshot'], queryFn: adminUsersSnapshot, staleTime: 30_000 });
  const s = q.data;
  if (!s) return null;

  // 用户×模型热力(矩阵转 2D:行=Top用户,列=Top模型)
  const users = Array.from(new Set(s.user_model_matrix.map((m) => m.user)));
  const models = Array.from(new Set(s.user_model_matrix.map((m) => m.model)));
  const umData: Array<[number, number, number]> = s.user_model_matrix.map((m) => [models.indexOf(m.model), users.indexOf(m.user), m.count]);
  const umMax = s.user_model_matrix.reduce((mx, m) => Math.max(mx, m.count), 0);
  const umOption = {
    tooltip: { position: 'top' },
    grid: { left: 90, right: 16, top: 10, bottom: 40 },
    xAxis: { type: 'category', data: models },
    yAxis: { type: 'category', data: users },
    visualMap: { min: 0, max: Math.max(1, umMax), calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
    series: [{ type: 'heatmap', data: umData }],
  };

  const radarOption = {
    radar: { indicator: [
      { name: '0-20', max: Math.max(1, ...s.feedback_hist) },
      { name: '20-40', max: Math.max(1, ...s.feedback_hist) },
      { name: '40-60', max: Math.max(1, ...s.feedback_hist) },
      { name: '60-80', max: Math.max(1, ...s.feedback_hist) },
      { name: '80-100', max: Math.max(1, ...s.feedback_hist) },
    ] },
    series: [{ type: 'radar', data: [{ value: s.feedback_hist, name: '反馈分布' }] }],
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-xl border p-2 lg:col-span-2">
        <div className="px-2 py-1 text-sm font-medium">用户 × 模型 热力</div>
        <AdminChart option={umOption} />
      </div>
      <div className="rounded-xl border p-2 lg:col-span-2">
        <div className="px-2 py-1 text-sm font-medium">全局活跃时段(7×24)</div>
        <AdminChart option={heatOption(s.global_heatmap, s.global_heatmap_max)} />
      </div>
      <div className="rounded-xl border p-2 lg:col-span-2">
        <div className="px-2 py-1 text-sm font-medium">反馈分数分布</div>
        <AdminChart option={radarOption} />
      </div>
    </div>
  );
};

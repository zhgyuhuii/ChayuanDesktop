import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { metrics, type HardwareSnapshot } from '@chayuan/api';
import { AdminChart } from '../users/AdminChart';

const fmtBytes = (b: number) => {
  if (!b) return '0';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${u[i]}`;
};

const Kpi: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-xl border p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-semibold">{value}</div>
    {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
  </div>
);

export const PerformancePage: React.FC = () => {
  const q = useQuery<HardwareSnapshot>({ queryKey: ['admin', 'metrics', 'hardware'], queryFn: () => metrics.hardware(), refetchInterval: 3000, staleTime: 0 });
  const s = q.data;
  if (!s) return <p className="p-4 text-sm text-muted-foreground">加载中…</p>;

  const coreOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 10, bottom: 20 },
    xAxis: { type: 'category', data: s.cpu_per_core.map((_, i) => `C${i}`) },
    yAxis: { type: 'value', max: 100 },
    series: [{ type: 'bar', data: s.cpu_per_core }],
  };
  const memOption = {
    series: [{
      type: 'gauge', max: 100, progress: { show: true },
      detail: { valueAnimation: true, formatter: '{value}%' },
      data: [{ value: Math.round(s.mem_percent), name: '内存' }],
    }],
  };

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="CPU" value={`${s.cpu_percent.toFixed(0)}%`} sub={`${s.cpu_count_logical} 逻辑核`} />
        <Kpi label="内存" value={`${s.mem_percent.toFixed(0)}%`} sub={`${fmtBytes(s.mem_used)} / ${fmtBytes(s.mem_total)}`} />
        <Kpi label="负载(1m)" value={s.load_1.toFixed(2)} sub={`5m ${s.load_5.toFixed(2)} · 15m ${s.load_15.toFixed(2)}`} />
        <Kpi label="网络" value={fmtBytes(s.net_bytes_recv)} sub={`↑ ${fmtBytes(s.net_bytes_sent)}`} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">每核占用</div><AdminChart option={coreOption} height={220} /></div>
        <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">内存</div><AdminChart option={memOption} height={220} /></div>
      </div>
      <div className="rounded-xl border p-3">
        <div className="mb-2 text-sm font-medium">磁盘</div>
        {s.disks.map((d) => (
          <div key={d.mount} className="mb-2">
            <div className="flex justify-between text-xs"><span>{d.mount}</span><span>{fmtBytes(d.used)} / {fmtBytes(d.total)} ({d.percent.toFixed(0)}%)</span></div>
            <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-sky-500" style={{ width: `${Math.min(100, d.percent)}%` }} /></div>
          </div>
        ))}
      </div>
      {s.gpus.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {s.gpus.map((g, i) => (
            <div key={i} className="rounded-xl border p-3">
              <div className="font-medium">{g.name}</div>
              <div className="text-xs text-muted-foreground">利用率 {g.util}% · 显存 {fmtBytes(g.mem_used)}/{fmtBytes(g.mem_total)} · {g.temp}°C</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

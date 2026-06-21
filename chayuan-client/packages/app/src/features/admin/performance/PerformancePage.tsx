import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { metrics, type HardwareSnapshot, type ScalabilityReport, type ScalabilityCheck, type ScalabilitySeverity } from '@chayuan/api';
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

const SEV_STYLE: Record<ScalabilitySeverity, { label: string; cls: string; dot: string }> = {
  critical: { label: '严重', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400', dot: '#ef4444' },
  warning: { label: '警告', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400', dot: '#f59e0b' },
  info: { label: '提示', cls: 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300', dot: '#94a3b8' },
  ok: { label: '良好', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400', dot: '#22c55e' },
};

const CheckRow: React.FC<{ c: ScalabilityCheck }> = ({ c }) => {
  const st = SEV_STYLE[c.severity] ?? SEV_STYLE.info;
  return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: st.dot }} />
        <span className="text-sm font-medium">{c.title}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
      </div>
      <div className="mt-1 text-xs opacity-70">{c.summary}</div>
      {c.impact ? <div className="mt-0.5 text-[11px] opacity-50">影响：{c.impact}</div> : null}
      {c.fix_hint ? <div className="mt-0.5 text-[11px] text-[var(--cy-brand-600)]">建议：{c.fix_hint}</div> : null}
      {c.snippet ? (
        <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-900 px-3 py-2 text-[11px] leading-relaxed text-zinc-100">
{c.snippet}
        </pre>
      ) : null}
    </div>
  );
};

const ScalabilityPanel: React.FC = () => {
  const q = useQuery<ScalabilityReport>({
    queryKey: ['admin', 'metrics', 'scalability'],
    queryFn: () => metrics.scalability(),
    staleTime: 30_000,
  });
  const r = q.data;
  if (q.isLoading && !r) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">诊断加载中…</div>;
  if (!r) return null;
  const counts = r.counts ?? { critical: 0, warning: 0, info: 0, ok: 0 };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
        <div>
          <div className="text-xs text-muted-foreground">并发承载估算（部署模式：{r.mode}）</div>
          <div className="mt-1 text-xl font-semibold">{r.est_concurrent_users || '—'}</div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {(['critical', 'warning', 'info', 'ok'] as ScalabilitySeverity[]).map((sev) => (
            <span key={sev} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SEV_STYLE[sev].dot }} />
              {SEV_STYLE[sev].label} {counts[sev] ?? 0}
            </span>
          ))}
          <span className="opacity-50">评分 {r.score}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(r.checks ?? []).map((c) => (
          <CheckRow key={c.key} c={c} />
        ))}
      </div>
    </div>
  );
};

export const PerformancePage: React.FC = () => {
  const q = useQuery<HardwareSnapshot>({ queryKey: ['admin', 'metrics', 'hardware'], queryFn: () => metrics.hardware(), refetchInterval: 3000, staleTime: 0 });
  const s = q.data;
  if (!s) return <p className="p-4 text-sm text-muted-foreground">加载中…</p>;

  // 防御纵深:后端偶发降级 / 缺字段时给安全默认,避免整页 .map/.toFixed 崩溃。
  const perCore: number[] = Array.isArray(s.cpu_per_core) ? s.cpu_per_core : [];
  const disks = Array.isArray(s.disks) ? s.disks : [];
  const gpus = Array.isArray(s.gpus) ? s.gpus : [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const coreOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 10, bottom: 20 },
    xAxis: { type: 'category', data: perCore.map((_, i) => `C${i}`) },
    yAxis: { type: 'value', max: 100 },
    series: [{ type: 'bar', data: perCore }],
  };
  const memOption = {
    series: [{
      type: 'gauge', max: 100, progress: { show: true },
      detail: { valueAnimation: true, formatter: '{value}%' },
      data: [{ value: Math.round(num(s.mem_percent)), name: '内存' }],
    }],
  };

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="CPU" value={`${num(s.cpu_percent).toFixed(0)}%`} sub={`${num(s.cpu_count_logical)} 逻辑核`} />
        <Kpi label="内存" value={`${num(s.mem_percent).toFixed(0)}%`} sub={`${fmtBytes(num(s.mem_used))} / ${fmtBytes(num(s.mem_total))}`} />
        <Kpi label="负载(1m)" value={num(s.load_1).toFixed(2)} sub={`5m ${num(s.load_5).toFixed(2)} · 15m ${num(s.load_15).toFixed(2)}`} />
        <Kpi label="网络" value={fmtBytes(num(s.net_bytes_recv))} sub={`↑ ${fmtBytes(num(s.net_bytes_sent))}`} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">每核占用</div><AdminChart option={coreOption} height={220} /></div>
        <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">内存</div><AdminChart option={memOption} height={220} /></div>
      </div>
      <div className="rounded-xl border p-3">
        <div className="mb-2 text-sm font-medium">磁盘</div>
        {disks.map((d) => (
          <div key={d.mount} className="mb-2">
            <div className="flex justify-between text-xs"><span>{d.mount}</span><span>{fmtBytes(d.used)} / {fmtBytes(d.total)} ({d.percent.toFixed(0)}%)</span></div>
            <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-sky-500" style={{ width: `${Math.min(100, d.percent)}%` }} /></div>
          </div>
        ))}
      </div>
      {gpus.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {gpus.map((g, i) => (
            <div key={i} className="rounded-xl border p-3">
              <div className="font-medium">{g.name}</div>
              <div className="text-xs text-muted-foreground">利用率 {g.util}% · 显存 {fmtBytes(g.mem_used)}/{fmtBytes(g.mem_total)} · {g.temp}°C</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pt-2">
        <div className="mb-2 text-sm font-medium">可扩展性诊断</div>
        <ScalabilityPanel />
      </div>
    </div>
  );
};

/**
 * ServicesConfigPage —— 管理控制台「服务状态」域(P6)。
 * 三段:① 基础设施/默认模型就绪卡(service_checks) ② 运行时框架健康(只读)
 * ③ 外部运行时端点注册(已部署在 GPU 机 / k8s 的服务,填 URL 接进来)。
 * 框架容器启停(docker up/down)延后,仅展示状态。
 */
import * as React from 'react';
import {
  servicesConfig,
  type ServiceStatusRow,
  type FrameworkHealth,
  type ExternalRuntime,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Plus, Wifi } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';

const LEVEL_ZH: Record<string, string> = { critical: '必填', recommended: '推荐', optional: '可选' };
const STATE_TONE: Record<string, string> = {
  running: 'text-emerald-600', installed: 'text-sky-600', configured: 'text-amber-600', missing: 'opacity-40',
};

export const ServicesConfigPage: React.FC = () => {
  const [statuses, setStatuses] = React.useState<ServiceStatusRow[]>([]);
  const [ready, setReady] = React.useState<boolean | null>(null);
  const [frameworks, setFrameworks] = React.useState<FrameworkHealth[]>([]);
  const [external, setExternal] = React.useState<ExternalRuntime[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  // external 编辑
  const [eName, setEName] = React.useState('');
  const [eUrl, setEUrl] = React.useState('');
  const [eHealth, setEHealth] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [r, f, e] = await Promise.all([
        servicesConfig.readiness().catch(() => ({ statuses: [], system_ready: false })),
        servicesConfig.frameworks().catch(() => ({ frameworks: [] })),
        servicesConfig.externalList().catch(() => ({ runtimes: [] })),
      ]);
      setStatuses(r.statuses);
      setReady(r.system_ready);
      setFrameworks(f.frameworks);
      setExternal(e.runtimes);
    } catch (err) {
      reportError(err, '加载服务状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const probe = async () => {
    if (!eUrl.trim()) return;
    setBusy(true);
    try {
      const r = await servicesConfig.externalProbe(eUrl.trim());
      r.ok ? notifySuccess(`连通：${r.message}`) : reportError(new Error(r.message), '探测失败');
    } catch (e) {
      reportError(e, '探测失败');
    } finally {
      setBusy(false);
    }
  };

  const saveExternal = async () => {
    if (!eName.trim() || !eUrl.trim()) return;
    setBusy(true);
    try {
      const r = await servicesConfig.externalSet({
        name: eName.trim(), url: eUrl.trim(), health_path: eHealth.trim() || undefined, enabled: true,
      });
      if (r.ok) {
        notifySuccess('已注册');
        setEName(''); setEUrl(''); setEHealth('');
        await load();
      } else reportError(new Error(r.message), '注册失败');
    } catch (e) {
      reportError(e, '注册失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleExternal = async (rt: ExternalRuntime) => {
    setBusy(true);
    try {
      await servicesConfig.externalSet({ name: rt.name, url: rt.url, health_path: rt.health_path, enabled: !rt.enabled });
      await load();
    } catch (e) {
      reportError(e, '切换失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">服务状态</h2>
          <p className="mt-1 text-xs opacity-60">基础设施 / 默认模型就绪 + 运行时框架 + 外部端点注册。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 重新探测
        </Button>
      </div>

      {/* 就绪 */}
      {ready !== null && (
        <div className={`rounded-md px-3 py-2 text-sm ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {ready ? '✅ 系统关键服务已就绪' : '⚠️ 尚有关键服务未就绪'}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {statuses.map((s) => (
          <div key={s.service} className="rounded-lg border border-[var(--cy-border-subtle)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{s.label}</span>
              <span className={`h-2 w-2 rounded-full ${s.ok ? 'bg-emerald-500' : s.configured ? 'bg-amber-500' : 'bg-zinc-300'}`} />
            </div>
            <div className="mt-1 text-[11px] opacity-60">
              {LEVEL_ZH[s.level] ?? s.level} · {s.ok ? '就绪' : s.configured ? '未连通' : '未配置'}
              {typeof s.latency_ms === 'number' ? ` · ${s.latency_ms}ms` : ''}
            </div>
            {s.detail && <div className="mt-1 truncate text-[11px] opacity-40" title={s.detail}>{s.detail}</div>}
          </div>
        ))}
      </div>

      {/* 框架 */}
      <div>
        <div className="mb-2 text-sm font-medium">运行时框架</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {frameworks.map((f) => (
            <div key={f.name} className="rounded-lg border border-[var(--cy-border-subtle)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{f.label}</span>
                <span className={`text-[11px] ${STATE_TONE[f.state] ?? ''}`}>{f.state}</span>
              </div>
              {f.capabilities.length > 0 && (
                <div className="mt-1 text-[11px] opacity-50">{f.capabilities.join(' · ')}</div>
              )}
              {f.url && <div className="mt-1 truncate text-[11px] opacity-40">{f.url}</div>}
            </div>
          ))}
          {frameworks.length === 0 && <div className="text-xs opacity-40">无</div>}
        </div>
        <p className="mt-1 text-[11px] opacity-40">框架的容器启停(docker up/down)暂在桌面端 / NiceGUI 操作,此处仅展示状态。</p>
      </div>

      {/* 外部端点 */}
      <div>
        <div className="mb-2 text-sm font-medium">外部运行时端点</div>
        <div className="space-y-1">
          {external.map((rt) => (
            <div key={rt.name} className="flex items-center gap-3 rounded-lg border border-[var(--cy-border-subtle)] px-3 py-2 text-xs">
              <span className="w-24 shrink-0 font-medium">{rt.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono opacity-70">{rt.url}</span>
              {rt.health_path && <span className="opacity-40">{rt.health_path}</span>}
              <button onClick={() => void toggleExternal(rt)} className={`rounded-full px-2 py-0.5 ${rt.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 opacity-60'}`}>
                {rt.enabled ? '启用' : '停用'}
              </button>
            </div>
          ))}
          {external.length === 0 && <div className="text-xs opacity-40">尚未注册外部端点</div>}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--cy-border-subtle)] p-3">
          <label className="text-xs"><span className="opacity-60">名称(框架)</span>
            <input className="mt-1 w-32 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-sm dark:bg-zinc-800" placeholder="infinity/comfyui…" value={eName} onChange={(e) => setEName(e.target.value)} /></label>
          <label className="min-w-0 flex-1 text-xs"><span className="opacity-60">URL</span>
            <input className="mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-sm dark:bg-zinc-800" placeholder="http://10.0.0.5:7997" value={eUrl} onChange={(e) => setEUrl(e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">健康路径(可选)</span>
            <input className="mt-1 w-28 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-sm dark:bg-zinc-800" placeholder="/health" value={eHealth} onChange={(e) => setEHealth(e.target.value)} /></label>
          <Button variant="outline" size="sm" onClick={() => void probe()} disabled={busy}><Wifi className="mr-1 h-3.5 w-3.5" />探测</Button>
          <Button size="sm" onClick={() => void saveExternal()} disabled={busy}><Plus className="mr-1 h-3.5 w-3.5" />注册</Button>
        </div>
      </div>
    </div>
  );
};

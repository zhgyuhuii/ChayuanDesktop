/**
 * ServiceTopologyPage —— 管理控制台「服务状态」域(S4,#11)。
 * 复用后端 GET /api/v1/admin/services/topology(包装 config_panel/service_page.build_snapshot)。
 * 三块:① SVG 拓扑图(节点状态色 + stroke-dasharray 流光动画连线,连线色随下游状态)
 *       ② 服务状态卡网格(点击可跳到对应配置域)
 *       ③「添加检测」弹窗(注册外部运行时端点,复用 servicesConfig.externalSet/externalProbe)。
 * 自动每 5s 刷新探活。
 */
import * as React from 'react';
import { servicesConfig, type TopologySnapshot, type TopologyNode, type TopologyStatus } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RedisConfigPage } from '../infra/RedisConfigPage';
import { DatabaseConfigPage } from '../infra/DatabaseConfigPage';
import { StorageConfigPage } from '../infra/StorageConfigPage';
import { ServicesConfigPage } from '../infra/ServicesConfigPage';
import { VectorStorePage } from '../config/VectorStorePage';
import { BasicSettingsPage } from '../config/BasicSettingsPage';
import { LangfuseConfig } from '../config/LangfuseConfigPage';
import { RefreshCw, Plus, X, Wifi, Settings2 } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';

// 画布尺寸(与后端 service_page 坐标系一致:x≤~1040,y≤~520)
const VB_W = 1060;
const VB_H = 520;
const NODE_W = 150;
const NODE_H = 54;

const STATUS_STYLE: Record<TopologyStatus, { border: string; bg: string; dot: string; edge: string; flow: boolean }> = {
  ok: { border: '#22c55e', bg: 'rgba(34,197,94,0.10)', dot: '#22c55e', edge: '#3b82f6', flow: true },
  down: { border: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dot: '#f59e0b', edge: '#f59e0b', flow: true },
  disabled: { border: '#d1d5db', bg: 'rgba(148,163,184,0.10)', dot: '#9ca3af', edge: '#d1d5db', flow: false },
  unknown: { border: '#9ca3af', bg: 'rgba(148,163,184,0.10)', dot: '#9ca3af', edge: '#cbd5e1', flow: true },
};
const STATUS_LABEL: Record<TopologyStatus, string> = { ok: '正常', down: '异常', disabled: '未启用', unknown: '未知' };

// config_kind → 复用的配置页组件(点击节点弹窗内渲染);无映射回退「服务配置」页。
const CONFIG_COMPONENT: Record<string, { title: string; Comp: React.FC }> = {
  redis: { title: 'Redis 配置', Comp: RedisConfigPage },
  db: { title: '数据库配置', Comp: DatabaseConfigPage },
  milvus: { title: '向量库配置', Comp: VectorStorePage },
  minio: { title: '对象存储配置', Comp: StorageConfigPage },
  langfuse: { title: 'Langfuse 链路追踪', Comp: LangfuseConfig },
};
const DEFAULT_CONFIG = { title: '服务配置', Comp: ServicesConfigPage };
function configFor(kind: string): { title: string; Comp: React.FC } {
  return CONFIG_COMPONENT[kind] ?? DEFAULT_CONFIG;
}

function edgeStatus(a?: TopologyNode, b?: TopologyNode): TopologyStatus {
  if (!a || !b) return 'unknown';
  if (a.status === 'disabled' || b.status === 'disabled') return 'disabled';
  if (a.status === 'down' || b.status === 'down') return 'down';
  if (a.status === 'ok' && b.status === 'ok') return 'ok';
  return 'unknown';
}

const TOPO_CSS = `
.topo-edge { fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 8 6; }
.topo-edge.flow { animation: topo-flow 1.1s linear infinite; }
@keyframes topo-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -28; } }
.topo-dot.pulse { animation: topo-pulse 1.4s infinite; }
@keyframes topo-pulse {
  0%,100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.topo-node { cursor: pointer; }
.topo-node:hover rect { stroke-width: 3.5; }
`;

const AddCheckDialog: React.FC<{ onClose: () => void; onAdded: () => void }> = ({ onClose, onAdded }) => {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [healthPath, setHealthPath] = React.useState('');
  const [probe, setProbe] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const FIELD =
    'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

  const doProbe = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setProbe(null);
    try {
      setProbe(await servicesConfig.externalProbe(url.trim()));
    } catch (e) {
      reportError(e, '探测失败');
    } finally {
      setBusy(false);
    }
  };
  const doSave = async () => {
    if (!name.trim() || !url.trim()) {
      reportError(new Error('名称和 URL 必填'), '无法保存');
      return;
    }
    setBusy(true);
    try {
      await servicesConfig.externalSet({ name: name.trim(), url: url.trim(), health_path: healthPath.trim() || undefined, enabled: true });
      notifySuccess('已注册外部检测端点');
      onAdded();
      onClose();
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">添加检测端点</h3>
          <button onClick={onClose} className="opacity-50 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs opacity-60">注册一个外部运行时/服务端点,纳入拓扑探活。例如 vLLM / Infinity / 自建推理服务。</p>
        <label className="mb-2 block text-xs">
          <span className="opacity-60">名称</span>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 vllm-a100" />
        </label>
        <label className="mb-2 block text-xs">
          <span className="opacity-60">URL</span>
          <input className={FIELD} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://10.0.0.5:8000" />
        </label>
        <label className="mb-2 block text-xs">
          <span className="opacity-60">健康检查路径(可选)</span>
          <input className={FIELD} value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/health" />
        </label>
        {probe && (
          <div className={`mb-2 rounded-md px-3 py-2 text-xs ${probe.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {probe.ok ? `连通成功。${probe.message || ''}` : `失败：${probe.message}`}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={() => void doSave()} disabled={busy}>
            <Plus className="mr-1.5 h-4 w-4" /> 添加
          </Button>
          <Button size="sm" variant="outline" onClick={() => void doProbe()} disabled={busy || !url.trim()}>
            <Wifi className="mr-1.5 h-4 w-4" /> 测试
          </Button>
        </div>
      </div>
    </div>
  );
};

export const ServiceTopologyPage: React.FC = () => {
  const [snap, setSnap] = React.useState<TopologySnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [auto, setAuto] = React.useState(true);
  const [showAdd, setShowAdd] = React.useState(false);
  const [cfgNode, setCfgNode] = React.useState<TopologyNode | null>(null);

  const load = React.useCallback(async (probe = true) => {
    setLoading(true);
    try {
      setSnap(await servicesConfig.topology(probe));
    } catch (e) {
      reportError(e, '读取服务拓扑失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(true);
  }, [load]);

  React.useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(true), 5000);
    return () => clearInterval(t);
  }, [auto, load]);

  const nodes = snap?.nodes ?? [];
  const byId = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const clickNode = (n: TopologyNode) => setCfgNode(n);

  return (
    <div className="space-y-5 p-6">
      <style>{TOPO_CSS}</style>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">服务状态 · 拓扑</h2>
          <p className="mt-1 text-xs opacity-60">
            实时探活,连线流光表示数据通路;点击节点/「配置」弹窗复用对应配置页。每 5s 自动刷新。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs opacity-70">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 自动刷新
          </label>
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> 添加检测
          </Button>
        </div>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-4 text-xs opacity-70">
        {(['ok', 'down', 'disabled', 'unknown'] as TopologyStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_STYLE[s].dot }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {/* 拓扑 SVG */}
      <div className="overflow-x-auto rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full min-w-[760px]" style={{ maxHeight: 540 }}>
          {/* edges */}
          {(snap?.edges ?? []).map(([a, b], i) => {
            const na = byId.get(a);
            const nb = byId.get(b);
            if (!na || !nb) return null;
            const mx = (na.x + nb.x) / 2;
            const es = edgeStatus(na, nb);
            const st = STATUS_STYLE[es];
            return (
              <path
                key={`${a}-${b}-${i}`}
                className={`topo-edge ${st.flow ? 'flow' : ''}`}
                stroke={st.edge}
                d={`M ${na.x} ${na.y} C ${mx} ${na.y}, ${mx} ${nb.y}, ${nb.x} ${nb.y}`}
              />
            );
          })}
          {/* nodes */}
          {nodes.map((n) => {
            const st = STATUS_STYLE[n.status];
            return (
              <g
                key={n.id}
                className="topo-node"
                transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}
                onClick={() => clickNode(n)}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill={st.bg}
                  stroke={st.border}
                  strokeWidth={2}
                />
                <circle
                  className={`topo-dot ${n.status === 'down' ? 'pulse' : ''}`}
                  cx={14}
                  cy={NODE_H / 2}
                  r={5}
                  fill={st.dot}
                />
                <text x={28} y={NODE_H / 2 - 4} fontSize={12} fontWeight={600} fill="var(--cy-text-primary)">
                  {n.label.length > 11 ? `${n.label.slice(0, 11)}…` : n.label}
                </text>
                <text x={28} y={NODE_H / 2 + 12} fontSize={9} fill="var(--cy-text-secondary, #94a3b8)">
                  {(n.summary || STATUS_LABEL[n.status]).slice(0, 18)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 状态卡网格 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nodes
          .filter((n) => n.group !== 'edge')
          .map((n) => {
            const st = STATUS_STYLE[n.status];
            return (
              <div
                key={n.id}
                className="rounded-lg border bg-[var(--cy-surface-1)] p-3"
                style={{ borderColor: st.border }}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: st.dot }} />
                    {n.label}
                  </span>
                  <span className="text-[10px] uppercase opacity-50">{n.group}</span>
                </div>
                <div className="mt-1 text-xs opacity-60">{n.summary || '—'}</div>
                {n.detail && <div className="mt-0.5 text-[11px] opacity-45">{n.detail}</div>}
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: st.bg, color: st.dot }}
                  >
                    {STATUS_LABEL[n.status]}
                  </span>
                  <button
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--cy-brand-600)] hover:underline"
                    onClick={() => setCfgNode(n)}
                  >
                    <Settings2 className="h-3 w-3" /> 配置
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {cfgNode ? (() => {
        const { title, Comp } = configFor(cfgNode.config_kind);
        return (
          <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={() => setCfgNode(null)}>
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-5 py-3">
                <h3 className="text-sm font-semibold">{cfgNode.label} · {title}</h3>
                <button onClick={() => setCfgNode(null)} className="opacity-50 hover:opacity-100"><X className="h-4 w-4" /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto"><Comp /></div>
            </div>
          </div>
        );
      })() : null}

      {showAdd && <AddCheckDialog onClose={() => setShowAdd(false)} onAdded={() => void load(true)} />}
    </div>
  );
};

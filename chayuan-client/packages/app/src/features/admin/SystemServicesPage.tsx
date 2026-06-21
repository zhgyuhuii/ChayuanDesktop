/**
 * Admin · 系统服务（运行时端口 / 凭据 / vendor / 本地模型）
 *
 * 数据源：
 *   - GET  /runtime/services         所有受管服务的端点 + 凭据（默认掩码）
 *   - POST /runtime/services/recheck 重跑 PortAllocator
 *   - GET  /runtime/vendor           扫描 vendor/ 目录，列出已就绪的离线包
 *   - GET  /runtime/models           本地模型索引
 *   - POST /runtime/models/scan      强制重扫
 *   - SSE  /runtime/models/events    模型变化实时推送
 *
 * 与"模型广场（marketplace）"的边界：
 *   marketplace 关心"有哪些云端模型可下载"，本页面关心"机器上目前实际跑着什么"。
 */

import * as React from 'react';
import { copyText } from '@chayuan/platform-shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Check, Copy, Eye, EyeOff, Folder, HardDrive, Plug, RefreshCw, Server, Settings,
} from 'lucide-react';
import { Button, cn } from '@chayuan/ui';
import {
  type LocalModelEntry,
  type RuntimeServiceEndpoint,
  type ScanDeltaPayload,
  type VendorEntry,
  type RuntimeRunStatus,
  type VendorPayload,
  runtimeServices,
  runtimeVendor,
  runtimeModels,
} from '@chayuan/api';
import { notifySuccess, reportError } from '../../store/errorDialog';

const SERVICES_KEY = ['runtime', 'services'] as const;
const VENDOR_KEY = ['runtime', 'vendor'] as const;
const MODELS_KEY = ['runtime', 'models'] as const;

export const SystemServicesPage: React.FC = () => {
  const [reveal, setReveal] = React.useState(false);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5" /> 系统服务
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            运行时端口、凭据、vendor 离线包与本地模型索引；用于排查"端口被占 / 默认密码被改"等问题。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReveal((v) => !v)}
            title={reveal ? '隐藏密码' : '显示明文密码'}
          >
            {reveal ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {reveal ? '隐藏密码' : '显示密码'}
          </Button>
        </div>
      </header>

      <ServicesSection reveal={reveal} />
      <RunningRuntimesSection />
      <VendorSection />
      <LocalModelsSection />
    </div>
  );
};

// ---------------------------------------------------------------------------
// services
// ---------------------------------------------------------------------------

const ServicesSection: React.FC<{ reveal: boolean }> = ({ reveal }) => {
  const qc = useQueryClient();
  const services = useQuery({
    queryKey: [...SERVICES_KEY, reveal] as const,
    queryFn: () => runtimeServices.list({ reveal }),
    staleTime: 5_000,
  });
  const recheckMut = useMutation({
    mutationFn: () => runtimeServices.recheck(),
    onSuccess: () => {
      notifySuccess('已重新分配端口与凭据');
      void qc.invalidateQueries({ queryKey: SERVICES_KEY });
    },
    onError: (e) => reportError(e, 'service.recheck 失败'),
  });

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Plug className="h-4 w-4" /> 受管服务
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: SERVICES_KEY })}
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={recheckMut.isPending}
            onClick={() => recheckMut.mutate()}
          >
            <Settings className="h-4 w-4 mr-1" />
            重新分配端口
          </Button>
        </div>
      </header>
      {services.data?.warning ? (
        <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {services.data.warning}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>名称</Th>
              <Th>类型</Th>
              <Th>地址 / URL</Th>
              <Th>用户</Th>
              <Th>密码</Th>
              <Th>启动时间</Th>
            </tr>
          </thead>
          <tbody>
            {(services.data?.services ?? []).map((s) => (
              <ServiceRow key={s.name ?? s.url} ep={s} />
            ))}
            {!services.isLoading && (services.data?.services?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                  还没有任何服务被记录。先执行一次"重新分配端口"或启动 chayuan。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const ServiceRow: React.FC<{ ep: RuntimeServiceEndpoint }> = ({ ep }) => {
  const url = ep.url || `${ep.host ?? ''}:${ep.port ?? ''}`;
  return (
    <tr className="border-t">
      <Td className="font-medium">{ep.name ?? '-'}</Td>
      <Td className="text-xs text-muted-foreground">{ep.kind ?? '-'}</Td>
      <Td>
        <code className="text-xs break-all">{url}</code>
        <CopyButton value={url} />
      </Td>
      <Td>
        {ep.user ? (
          <>
            <code className="text-xs">{ep.user}</code>
            <CopyButton value={ep.user} />
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </Td>
      <Td>
        {ep.password ? (
          <>
            <code className="text-xs">{ep.password}</code>
            {ep.password !== '****' ? <CopyButton value={ep.password} /> : null}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </Td>
      <Td className="text-xs text-muted-foreground">
        {ep.started_at ? new Date(ep.started_at * 1000).toLocaleString() : '—'}
      </Td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// 运行中的本地 sidecar(llama/whisper/infinity 等)实时状态 —— 让"系统服务看到已启动"(#10)
const RUN_STYLE: Record<string, { label: string; cls: string }> = {
  ready: { label: '已启动', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' },
  starting: { label: '启动中', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  restarting: { label: '重启中', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  failed: { label: '失败', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400' },
  stopped: { label: '未启动', cls: 'bg-muted text-muted-foreground' },
};

const RunningRuntimesSection: React.FC = () => {
  const vendor = useQuery<VendorPayload>({
    queryKey: VENDOR_KEY,
    queryFn: () => runtimeVendor.list(),
    refetchInterval: 5000,
  });
  const running: Record<string, RuntimeRunStatus> = vendor.data?.running ?? {};
  const entries = Object.entries(running);
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium flex items-center gap-2">
        <Server className="h-4 w-4" /> 运行中的本地服务
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        vendor 二进制(llama-server / whisper-server / infinity 等)由后端按需拉起;此处显示其实时运行状态与监听端点。docker 部署下 vendor 已随镜像打包,启动后即在此可见。
      </p>
      {!entries.length ? (
        <div className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
          暂无已拉起的本地服务(按需启动:发起对话 / 检索 / 语音任务时自动拉起对应 sidecar)。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([cap, st]) => {
            const sty = RUN_STYLE[st.state] ?? { label: st.state || '未知', cls: 'bg-muted text-muted-foreground' };
            return (
              <div key={cap} className="rounded border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{cap}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', sty.cls)}>{sty.label}</span>
                </div>
                {st.endpoint ? <div className="mt-1 text-muted-foreground">端点: <code>{st.endpoint}</code></div> : null}
                {st.model_id ? <div className="mt-0.5 text-muted-foreground truncate">模型: {st.model_id}</div> : null}
                {st.pid ? <div className="mt-0.5 text-muted-foreground">PID: {st.pid}</div> : null}
                {st.state === 'failed' && st.last_error ? (
                  <div className="mt-1 text-rose-600">{st.last_error}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

// vendor
// ---------------------------------------------------------------------------

const VendorSection: React.FC = () => {
  const qc = useQueryClient();
  const vendor = useQuery<VendorPayload>({
    queryKey: VENDOR_KEY,
    queryFn: () => runtimeVendor.list(),
    staleTime: 30_000,
  });
  const groups: Array<[string, VendorEntry[]]> = [
    ['后端服务（services/）', vendor.data?.services ?? []],
    ['推理运行时（runtimes/）', vendor.data?.runtimes ?? []],
    ['未识别（unknown/）', vendor.data?.unknown ?? []],
  ];

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Folder className="h-4 w-4" /> Vendor 离线包
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: VENDOR_KEY })}
          title="重新扫描"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </header>
      <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        扫描根目录：<code className="text-[11px]">{vendor.data?.root ?? '(loading)'}</code>。
        把第三方二进制 / docker-compose.yml 放进 <code>vendor/services/</code> 或 <code>vendor/runtimes/</code> 下相应子目录即可被自动识别（详见仓库 <code>vendor/README.md</code>）。
      </p>
      <div className="space-y-4 p-4">
        {groups.map(([label, items]) => (
          <div key={label}>
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{label}</h4>
            {items.length === 0 ? (
              <div className="text-xs text-muted-foreground">— 空 —</div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {items.map((e) => (
                  <VendorCard key={`${e.group}-${e.name}`} entry={e} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

const VendorCard: React.FC<{ entry: VendorEntry }> = ({ entry }) => (
  <div className={cn('rounded border p-3 text-xs', entry.available ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-muted/40')}>
    <div className="flex items-center justify-between">
      <div className="font-medium text-sm flex items-center gap-1">
        {entry.available ? (
          <Check className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-600" />
        )}
        {entry.label}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {entry.kind} · port {entry.default_port || '?'}
      </span>
    </div>
    <div className="mt-1 text-muted-foreground break-all">{entry.path}</div>
    {entry.binary ? <div className="mt-1">binary: <code>{entry.binary}</code></div> : null}
    {entry.docker_compose ? <div className="mt-1">compose: <code>{entry.docker_compose}</code></div> : null}
    {entry.issues.length > 0 ? (
      <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-400">
        {entry.issues.map((it) => (<li key={it}>! {it}</li>))}
      </ul>
    ) : null}
  </div>
);

// ---------------------------------------------------------------------------
// local models
// ---------------------------------------------------------------------------

const LocalModelsSection: React.FC = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<string>('');
  const [liveLog, setLiveLog] = React.useState<string[]>([]);

  const models = useQuery({
    queryKey: [...MODELS_KEY, filter] as const,
    queryFn: () => runtimeModels.list({ capability: filter || undefined }),
    staleTime: 5_000,
  });

  const scanMut = useMutation({
    mutationFn: () => runtimeModels.scan(),
    onSuccess: (delta: ScanDeltaPayload) => {
      notifySuccess(`扫描完成：+${delta.added.length}  ~${delta.updated.length}  -${delta.removed.length}`);
      void qc.invalidateQueries({ queryKey: MODELS_KEY });
    },
    onError: (e) => reportError(e, 'model.scan 失败'),
  });

  React.useEffect(() => {
    const unsubscribe = runtimeModels.subscribeEvents({
      onChange: (delta) => {
        const summary = `+${delta.added.length} ~${delta.updated.length} -${delta.removed.length} @ ${new Date(delta.ts * 1000).toLocaleTimeString()}`;
        setLiveLog((logs) => [summary, ...logs].slice(0, 20));
        void qc.invalidateQueries({ queryKey: MODELS_KEY });
      },
      // SSE 鉴权失败 / 离线场景：吞掉，UI 上由"刷新"按钮兜底
      onError: () => undefined,
    });
    return unsubscribe;
  }, [qc]);

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <HardDrive className="h-4 w-4" /> 本地模型索引
        </h3>
        <div className="flex items-center gap-2">
          <select
            className="rounded border bg-background px-2 py-1 text-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">全部能力</option>
            <option value="chat">chat</option>
            <option value="text-embedding">text-embedding</option>
            <option value="rerank">rerank</option>
            <option value="image-to-text">image-to-text</option>
            <option value="text-to-image">text-to-image</option>
            <option value="text-to-video">text-to-video</option>
            <option value="text-to-audio">text-to-audio</option>
            <option value="speech-to-text">speech-to-text</option>
            <option value="other">other</option>
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: MODELS_KEY })}
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={scanMut.isPending}
            onClick={() => scanMut.mutate()}
          >
            重扫磁盘
          </Button>
        </div>
      </header>
      {liveLog.length > 0 ? (
        <div className="border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          实时事件：{liveLog[0]}（最近 {liveLog.length} 条）
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>model_id</Th>
              <Th>能力</Th>
              <Th>格式</Th>
              <Th className="text-right">大小</Th>
              <Th>路径</Th>
              <Th>来源</Th>
            </tr>
          </thead>
          <tbody>
            {(models.data?.items ?? []).map((m) => (
              <ModelRow key={m.model_id} m={m} />
            ))}
            {!models.isLoading && (models.data?.items?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                  本地索引为空。把模型放进 <code>&lt;CHAYUAN_ROOT&gt;/models/</code> 下后点"重扫磁盘"。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const ModelRow: React.FC<{ m: LocalModelEntry }> = ({ m }) => (
  <tr className="border-t">
    <Td className="font-medium break-all">{m.model_id}</Td>
    <Td>{m.capability}</Td>
    <Td>{m.format}</Td>
    <Td className="text-right tabular-nums">{(m.size_bytes / 1024 / 1024).toFixed(1)} MiB</Td>
    <Td>
      <code className="text-xs break-all">{m.path}</code>
    </Td>
    <Td className="text-xs text-muted-foreground">{m.source_tag}</Td>
  </tr>
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const Th: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className }) => (
  <th className={cn('px-3 py-2 text-left font-medium', className)}>{children}</th>
);

const Td: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className }) => (
  <td className={cn('px-3 py-2 align-top', className)}>{children}</td>
);

const CopyButton: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-1 h-6 w-6 p-0 align-middle"
      onClick={async () => {
        try {
          await copyText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // noop
        }
      }}
      title="复制"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
};

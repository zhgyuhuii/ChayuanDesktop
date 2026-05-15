/**
 * 「系统设置 → AI 平台 → 本地模型」分页。
 *
 * 布局:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [状态色块]  endpoint http://127.0.0.1:62582  · pid 1234   │
 *   │   model_id: Qwen3-4B-Instruct-2507-Q3_K_S                │
 *   │ [启动][停止][重启]  最近错误:xxx                          │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ 配置                                                      │
 *   │   预热开关 / Host / Port / API Key / LAN 开关             │
 *   │   [保存]                                                  │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ 装机路径                                                  │
 *   │   chayuan_root: /data/cy                  [复制]          │
 *   │   models_root: /data/cy/models            [复制]          │
 *   │   llama_server: /install/.../llama-server.exe (b4404)     │
 *   └──────────────────────────────────────────────────────────┘
 */

import * as React from 'react';
import { ClipboardList, Copy, Play, Square, RotateCw, X } from 'lucide-react';
import { Button } from '@chayuan/ui';
import { useLocalRuntimeStore } from '../../store/localRuntime';
import { LocalRuntimeStatusBadge } from './LocalRuntimeStatusBadge';
import { LocalRuntimeConfigForm } from './LocalRuntimeConfigForm';
import { DiagnoseModal } from './DiagnoseModal';

const POLL_INTERVAL_MS = 5_000;

function useLocalRuntimePolling() {
  const refreshStatus = useLocalRuntimeStore((s) => s.refreshStatus);
  React.useEffect(() => {
    void refreshStatus();
    const t = window.setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [refreshStatus]);
}

export const LocalRuntimePanel: React.FC = () => {
  const {
    status,
    config,
    installInfo,
    pending,
    lastError,
    reachable,
    refreshConfig,
    refreshInstallInfo,
    start,
    stop,
    restart,
    saveConfig,
    clearError,
  } = useLocalRuntimeStore();
  useLocalRuntimePolling();
  const [diagnoseOpen, setDiagnoseOpen] = React.useState(false);

  React.useEffect(() => {
    void refreshConfig();
    void refreshInstallInfo();
  }, [refreshConfig, refreshInstallInfo]);

  if (!reachable) {
    return (
      <div className="rounded-md border border-rose-500/30 bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
        无法连接 sidecar (
        <code className="rounded bg-rose-100 px-1 dark:bg-rose-900/40">/runtime/llama/*</code>)。
        本地模型功能仅在集成版桌面应用中可用,Web 端不支持。
      </div>
    );
  }

  const isPending = pending !== null;

  return (
    <div className="space-y-6">
      {/* 状态区 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <LocalRuntimeStatusBadge status={status} />
          {status?.endpoint && (
            <code className="text-xs text-[var(--cy-text-secondary)]">{status.endpoint}</code>
          )}
          {status?.pid != null && (
            <span className="text-xs text-[var(--cy-text-tertiary)]">pid {status.pid}</span>
          )}
        </div>
        {status?.model_id && (
          <div className="text-xs text-[var(--cy-text-secondary)]">
            模型:<code>{status.model_id}</code>
          </div>
        )}
        {status?.state === 'failed' && status.last_error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-50 p-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
            <div className="font-medium">最近错误</div>
            <div className="mt-1 whitespace-pre-wrap break-all">{status.last_error}</div>
          </div>
        )}
        {lastError && (
          <div className="flex items-center justify-between rounded-md border border-amber-400/40 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <span>{lastError}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clearError} aria-label="清除错误">
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void start()}
            disabled={isPending || status?.state === 'starting' || status?.state === 'ready'}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            启动
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void stop()}
            disabled={isPending || status?.state === 'stopped'}
          >
            <Square className="mr-1 h-3.5 w-3.5" />
            停止
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void restart()}
            disabled={isPending}
          >
            <RotateCw className={'mr-1 h-3.5 w-3.5' + (pending === 'restart' ? ' animate-spin' : '')} />
            重启
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDiagnoseOpen(true)}
          >
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            生成诊断报告
          </Button>
        </div>
      </section>

      <div className="h-px bg-[var(--cy-border-subtle)]" />

      {/* 配置区 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">配置</h3>
        <p className="text-xs text-[var(--cy-text-tertiary)]">
          改 host / port / API key 后需点「重启」让 llama-server 重新 bind。
        </p>
        {config ? (
          <LocalRuntimeConfigForm
            value={config}
            disabled={isPending}
            onSubmit={(patch) => void saveConfig(patch)}
          />
        ) : (
          <div className="text-xs text-[var(--cy-text-tertiary)]">加载配置中…</div>
        )}
      </section>

      <div className="h-px bg-[var(--cy-border-subtle)]" />

      {/* 装机路径 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">装机路径</h3>
        {installInfo ? (
          <div className="space-y-1.5 text-xs">
            <PathRow label="数据目录" value={installInfo.chayuan_root} />
            <PathRow label="模型根目录" value={installInfo.models_root} />
            <PathRow label="集成版模型" value={installInfo.bundled_models_root} />
            <PathRow
              label="llama-server"
              value={installInfo.llama_server_exe ?? '(未装机或集成版缺失)'}
              suffix={installInfo.build_version ? `build ${installInfo.build_version}` : undefined}
            />
          </div>
        ) : (
          <div className="text-xs text-[var(--cy-text-tertiary)]">加载装机信息中…</div>
        )}
      </section>
      <DiagnoseModal open={diagnoseOpen} onOpenChange={setDiagnoseOpen} />
    </div>
  );
};

const PathRow: React.FC<{ label: string; value: string; suffix?: string }> = ({
  label,
  value,
  suffix,
}) => (
  <div className="flex items-center gap-2">
    <span className="w-24 text-[var(--cy-text-tertiary)]">{label}</span>
    <code className="flex-1 truncate rounded bg-[var(--cy-surface-1)] px-1.5 py-0.5 text-[var(--cy-text-secondary)]">
      {value}
    </code>
    {suffix && (
      <span className="text-[10px] text-[var(--cy-text-tertiary)]">{suffix}</span>
    )}
    <Button
      size="icon"
      variant="ghost"
      className="h-6 w-6"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
      }}
      title="复制路径"
      aria-label="复制路径"
    >
      <Copy className="h-3 w-3" />
    </Button>
  </div>
);

export default LocalRuntimePanel;

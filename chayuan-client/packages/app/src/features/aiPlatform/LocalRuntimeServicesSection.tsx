/**
 * 设置页 `/settings` 中的「本地模型服务」分组。
 *
 * 5 个 capability(chat / embedding / rerank / asr / image-embedding)各一行:
 *   - 状态徽标 (LocalRuntimeStatusBadge)
 *   - 中文名(沿用 LocalRuntimeCapabilityCard 的 CAPABILITY_LABEL)
 *   - 当前 endpoint · pid 或 lastError
 *   - 模型下拉(从 GET /runtime/models 按 capability 分组)
 *   - 启动 / 停止 / 重启 按钮(按 state 切换)
 *
 * 顶部右侧:
 *   - 「刷新」按钮:手动触发 status + models 重拉
 *   - 「诊断」按钮:打开 DiagnoseModal
 *
 * 注:LocalRuntimePanel 完整版(配置表单 / 装机路径)保持原位,
 * 此分组只暴露"启停 + 选模型 + 诊断"三个高频动作。
 */
import * as React from 'react';
import { ClipboardList, Play, RefreshCw, RotateCw, Square } from 'lucide-react';
import {
  type LocalModelEntry,
  type LocalRuntimeCapability,
  runtimeModels,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { useLocalRuntimeStore } from '../../store/localRuntime';
import { DiagnoseModal } from './DiagnoseModal';
import { LocalRuntimeStatusBadge } from './LocalRuntimeStatusBadge';

const CAPABILITIES: LocalRuntimeCapability[] = [
  'chat',
  'embedding',
  'rerank',
  'asr',
  'image-embedding',
];

/** 与 LocalRuntimeCapabilityCard.tsx 保持同一处真源(后续两边一起改)。 */
const CAP_LABEL: Record<LocalRuntimeCapability, string> = {
  chat: '聊天',
  embedding: '文本嵌入',
  rerank: '重排',
  asr: '语音识别',
  'image-embedding': '图像嵌入',
};

export const LocalRuntimeServicesSection: React.FC = () => {
  const { statuses, pendingFor, reachable, startCapability, stopCapability, restartCapability } =
    useLocalRuntimeStore();

  const [models, setModels] = React.useState<Record<LocalRuntimeCapability, LocalModelEntry[]>>({
    chat: [],
    embedding: [],
    rerank: [],
    asr: [],
    'image-embedding': [],
  });
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<Partial<Record<LocalRuntimeCapability, string>>>({});
  const [diagnoseOpen, setDiagnoseOpen] = React.useState(false);

  const reloadModels = React.useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      // runtime.ts 的 runtimeModels.list 返回 { total, items } envelope
      const { items } = await runtimeModels.list();
      const grouped: Record<LocalRuntimeCapability, LocalModelEntry[]> = {
        chat: [], embedding: [], rerank: [], asr: [], 'image-embedding': [],
      };
      for (const m of items) {
        // runtime.ts LocalModelEntry.capability 是 string,需 narrow 到 LocalRuntimeCapability
        const cap = m.capability as LocalRuntimeCapability;
        if (grouped[cap]) grouped[cap].push(m);
      }
      setModels(grouped);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reloadModels();
  }, [reloadModels]);

  // 自己挂 capability registry 轮询(5s)。 Shell.tsx 全局轮询只跑 refreshStatus,
  // 不跑 refreshRegistry; LocalRuntimePanel 的轮询挂在 LocalRuntimePanel 内部,
  // 用户不打开它就拿不到 statuses,首次进 /settings 会看到 5 行 capability 全显示
  // stopped 即使实际 ready。这里独立挂一个,跟 LocalRuntimePanel 互不干扰。
  React.useEffect(() => {
    const { refreshStatus, refreshRegistry } = useLocalRuntimeStore.getState();
    void refreshStatus();
    void refreshRegistry();
    const t = window.setInterval(() => {
      void useLocalRuntimeStore.getState().refreshStatus();
      void useLocalRuntimeStore.getState().refreshRegistry();
    }, 5_000);
    return () => window.clearInterval(t);
  }, []);

  const resolveModelId = (cap: LocalRuntimeCapability): string | undefined =>
    chosen[cap] ?? statuses[cap]?.model_id ?? models[cap][0]?.model_id;

  const onRefresh = () => {
    void useLocalRuntimeStore.getState().refreshStatus();
    void useLocalRuntimeStore.getState().refreshRegistry();
    void reloadModels();
  };

  if (!reachable) {
    return (
      <section className="rounded-md border border-rose-500/30 bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
        无法连接 sidecar (
        <code className="rounded bg-rose-100 px-1 dark:bg-rose-900/40">/runtime/llama/*</code>)。
        本地模型服务仅在集成版桌面应用中可用。
      </section>
    );
  }

  return (
    <section className="rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--cy-text-primary)]">本地模型服务</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={modelsLoading}>
            <RefreshCw className={'mr-1 h-3.5 w-3.5' + (modelsLoading ? ' animate-spin' : '')} />
            刷新
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDiagnoseOpen(true)}>
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            诊断
          </Button>
        </div>
      </header>

      {modelsError && (
        <div className="rounded-sm border border-amber-400/40 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          模型清单加载失败:{modelsError} ·
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => void reloadModels()}
          >
            重试
          </button>
        </div>
      )}

      <div className="space-y-2">
        {CAPABILITIES.map((cap) => (
          <CapabilityRow
            key={cap}
            capability={cap}
            label={CAP_LABEL[cap]}
            status={statuses[cap]}
            pending={pendingFor[cap]}
            models={models[cap]}
            chosen={chosen[cap]}
            resolvedModelId={resolveModelId(cap)}
            onChoose={(id) => setChosen((s) => ({ ...s, [cap]: id }))}
            onStart={() => {
              const modelId = resolveModelId(cap);
              void startCapability(cap, modelId ? { model_id: modelId } : undefined);
            }}
            onStop={() => {
              void stopCapability(cap);
            }}
            onRestart={() => {
              const modelId = resolveModelId(cap);
              void restartCapability(cap, modelId ? { model_id: modelId } : undefined);
            }}
            onOpenDiagnose={() => setDiagnoseOpen(true)}
          />
        ))}
      </div>

      <DiagnoseModal open={diagnoseOpen} onOpenChange={setDiagnoseOpen} />
    </section>
  );
};

interface CapabilityRowProps {
  capability: LocalRuntimeCapability;
  label: string;
  status: import('@chayuan/api').LocalRuntimeStatus | null;
  pending: 'start' | 'stop' | 'restart' | null;
  models: LocalModelEntry[];
  chosen?: string;
  resolvedModelId?: string;
  onChoose(id: string): void;
  onStart(): void;
  onStop(): void;
  onRestart(): void;
  onOpenDiagnose(): void;
}

const CapabilityRow: React.FC<CapabilityRowProps> = ({
  label,
  status,
  pending,
  models,
  resolvedModelId,
  onChoose,
  onStart,
  onStop,
  onRestart,
  onOpenDiagnose,
}) => {
  const state = status?.state ?? 'stopped';
  const isPending = pending !== null;
  const isReady = state === 'ready';
  const isFailed = state === 'failed';
  const noModels = models.length === 0;

  const selectedId = resolvedModelId ?? '';

  return (
    <div className="rounded-md border border-[var(--cy-border-subtle)] p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <LocalRuntimeStatusBadge status={status} />
        <span className="text-sm font-medium text-[var(--cy-text-primary)]">{label}</span>
        {isReady && status?.endpoint && (
          <code className="text-xs text-[var(--cy-text-secondary)]">{status.endpoint}</code>
        )}
        {isReady && status?.pid != null && (
          <span className="text-xs text-[var(--cy-text-tertiary)]">pid {status.pid}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--cy-text-tertiary)]">模型</label>
        <select
          value={selectedId}
          onChange={(e) => onChoose(e.target.value)}
          disabled={noModels || isPending}
          className="rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
        >
          {noModels ? (
            <option value="">未安装,前往「模型广场」下载</option>
          ) : (
            models.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {m.model_id}
                {m.size_bytes ? ` (${prettyMB(m.size_bytes)})` : ''}
              </option>
            ))
          )}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          {!isReady && (
            <Button
              size="sm"
              onClick={onStart}
              disabled={isPending || noModels}
            >
              <Play
                className={'mr-1 h-3.5 w-3.5' + (pending === 'start' ? ' animate-pulse' : '')}
              />
              {isFailed ? '重试' : '启动'}
            </Button>
          )}
          {isReady && (
            <>
              <Button size="sm" variant="outline" onClick={onRestart} disabled={isPending}>
                <RotateCw
                  className={'mr-1 h-3.5 w-3.5' + (pending === 'restart' ? ' animate-spin' : '')}
                />
                重启
              </Button>
              <Button size="sm" variant="outline" onClick={onStop} disabled={isPending}>
                <Square className="mr-1 h-3.5 w-3.5" />
                停止
              </Button>
            </>
          )}
        </div>
      </div>

      {isFailed && status?.last_error && (
        <div className="rounded-sm border border-rose-500/30 bg-rose-50 p-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200 whitespace-pre-wrap break-all">
          {status.last_error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={onOpenDiagnose}
          >
            查看诊断
          </button>
        </div>
      )}
    </div>
  );
};

function prettyMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

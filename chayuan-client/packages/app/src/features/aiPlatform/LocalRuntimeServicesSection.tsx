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
import { ClipboardList, FileBarChart2, Play, RefreshCw, RotateCw, Square } from 'lucide-react';
import {
  type AutoStartDict,
  type AutoStartKey,
  localRuntime,
  type LocalModelEntry,
  type LocalRuntimeCapability,
  modality,
  type OcrSidecarStatus,
  type PytorchInstallTask,
  type PytorchStatus,
  type PytorchVariant,
  runtimeModels,
} from '@chayuan/api';
import { Button, Switch } from '@chayuan/ui';
import { useLocalRuntimeStore } from '../../store/localRuntime';
import { CallLogDialog } from './CallLogDialog';
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

/** 后端 install_info.bundled_caps / missing_caps 用的短名 ↔ 前端 capability key 映射。
 *  后端用 'image' 表示图像嵌入,前端用 'image-embedding';其它一致。 */
const BACKEND_CAP_KEY: Record<LocalRuntimeCapability, string> = {
  chat: 'chat',
  embedding: 'embedding',
  rerank: 'rerank',
  asr: 'asr',
  'image-embedding': 'image',
};

/** scanner identifier(chayuan-server identifier.py:_CAPABILITY_BY_MODELTYPE)给的 capability 字符串
 *  ↔ 前端 LocalRuntimeCapability 映射。scanner 用的是 HF-style 长名,前端用短名。
 *  没匹配上返回 null,跳过这条 entry(不计入任何 cap 的模型清单)。 */
function mapScannerCapability(
  scannerCap: string,
  format: string,
): LocalRuntimeCapability | null {
  switch (scannerCap) {
    case 'chat':           return 'chat';
    case 'text-embedding':
    case 'embedding':      return 'embedding';
    case 'rerank':         return 'rerank';
    case 'speech-to-text':
    case 'asr':            return 'asr';
    case 'image-to-text':
    case 'image-embedding':
    case 'image':
      // OCR(PP-OCRv3/v4)scanner 同样标 image-to-text/onnx,但 OCR 走进程内
      // rapidocr,不出现在 image-embedding 下拉;按 format 过滤掉。
      if (format === 'onnx') return null;
      return 'image-embedding';
    default:
      return null;
  }
}

export const LocalRuntimeServicesSection: React.FC = () => {
  const { statuses, pendingFor, reachable, startCapability, stopCapability, restartCapability } =
    useLocalRuntimeStore();
  const installInfo = useLocalRuntimeStore((s) => s.installInfo);

  // 当前安装包随包嵌入的 cap 集合(后端 install_info.bundled_caps)。
  // 老服务端没返此字段 → null,所有 cap 都视为已随包(向后兼容)。
  const bundledCaps = React.useMemo<Set<string> | null>(() => {
    if (!installInfo?.bundled_caps) return null;
    return new Set(installInfo.bundled_caps);
  }, [installInfo?.bundled_caps]);

  // 本 section 涉及的 5 个 cap 里,有哪些未随包(用于顶部 banner 列表)。
  const sectionMissingCaps = React.useMemo<LocalRuntimeCapability[]>(() => {
    if (bundledCaps == null) return [];
    return CAPABILITIES.filter((cap) => !bundledCaps.has(BACKEND_CAP_KEY[cap]));
  }, [bundledCaps]);

  const isLite = installInfo?.is_lite_build === true;

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
  const [callLogOpen, setCallLogOpen] = React.useState(false);

  // 5 个 capability + rapidocr 的 auto-start 开关字典 — 拉一次,Switch 切换写回。
  // 后端默认 5 cap 全 false / rapidocr true(见 auto_start_store._DEFAULTS),
  // 让老用户体验不变。
  const [autoStart, setAutoStart] = React.useState<AutoStartDict>({});
  const [autoStartPending, setAutoStartPending] = React.useState<AutoStartKey | null>(null);
  React.useEffect(() => {
    void (async () => {
      try {
        setAutoStart(await localRuntime.listAutoStart());
      } catch {
        // 老服务端没有这个端点,静默 — UI 显示默认值(全 off,OCR on)
      }
    })();
  }, []);
  const toggleAutoStart = React.useCallback(async (cap: AutoStartKey, enabled: boolean) => {
    setAutoStartPending(cap);
    try {
      setAutoStart(await localRuntime.setAutoStart(cap, enabled));
    } finally {
      setAutoStartPending(null);
    }
  }, []);

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
        // scanner identifier 给的 capability 跟前端 LocalRuntimeCapability enum 不一致:
        //   text-embedding   ↔ embedding
        //   speech-to-text   ↔ asr
        //   image-to-text    ↔ image-embedding(注意:OCR onnx 也是 image-to-text,要排除)
        // 原来直接 grouped[m.capability] 永远 undefined,模型被静默丢弃 → UI 显示"未安装"。
        const cap = mapScannerCapability(m.capability, m.format);
        if (cap && grouped[cap]) grouped[cap].push(m);
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
    const { refreshStatus, refreshRegistry, refreshInstallInfo } = useLocalRuntimeStore.getState();
    void refreshStatus();
    void refreshRegistry();
    // installInfo 只有 LocalRuntimePanel mount 时才拉,这里独立兜底一次,
    // 不然用户没打开 LocalRuntimePanel 就拿不到 bundled_caps / is_lite_build
    // → 无法在轻量版下显示「未随包」横幅。
    void refreshInstallInfo();
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
    const lastError = useLocalRuntimeStore.getState().lastError;
    return (
      <section
        id="local-runtime-services"
        className="rounded-md border border-rose-500/30 bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200 space-y-2"
      >
        <div>
          无法连接 sidecar (
          <code className="rounded bg-rose-100 px-1 dark:bg-rose-900/40">/runtime/llama/*</code>)。
        </div>
        {lastError && (
          <div className="rounded bg-rose-100 px-2 py-1 font-mono text-xs dark:bg-rose-900/40">
            {lastError}
          </div>
        )}
        <div className="text-xs opacity-80">
          常见原因:① chayuan-server 没起来(检查端口 62581 / 看终端是否在跑);
          ② 后端启动中(过几秒再试);
          ③ Web / Thin 模式下不带本地服务(只在集成版 .msi 里可用)。
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void useLocalRuntimeStore.getState().refreshStatus();
            void useLocalRuntimeStore.getState().refreshRegistry();
            void useLocalRuntimeStore.getState().refreshInstallInfo();
          }}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重试
        </Button>
      </section>
    );
  }

  return (
    <section
      id="local-runtime-services"
      className="rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] p-4 space-y-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--cy-text-primary)]">本地模型服务</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={modelsLoading}>
            <RefreshCw className={'mr-1 h-3.5 w-3.5' + (modelsLoading ? ' animate-spin' : '')} />
            刷新
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCallLogOpen(true)}
            title="查看语音识别 / OCR 最近调用日志"
          >
            <FileBarChart2 className="mr-1 h-3.5 w-3.5" />
            调用日志
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

      {isLite && sectionMissingCaps.length > 0 && (
        <div className="rounded-sm border border-amber-400/40 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-medium">当前是轻量版安装包</div>
          <div className="mt-0.5 text-amber-800 dark:text-amber-300">
            以下能力未随包嵌入,需在「模型广场」下载模型后才能启动:
            {sectionMissingCaps.map((cap, i) => (
              <span key={cap}>
                {i > 0 ? '、' : ' '}
                <span className="font-medium">{CAP_LABEL[cap]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {CAPABILITIES.map((cap) => {
          const isMissing =
            bundledCaps != null && !bundledCaps.has(BACKEND_CAP_KEY[cap]);
          return (
            <CapabilityRow
              key={cap}
              capability={cap}
              label={CAP_LABEL[cap]}
              status={statuses[cap]}
              pending={pendingFor[cap]}
              models={models[cap]}
              chosen={chosen[cap]}
              resolvedModelId={resolveModelId(cap)}
              isMissing={isMissing}
              autoStart={autoStart[cap] ?? false}
              autoStartPending={autoStartPending === cap}
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
              onToggleAutoStart={(enabled) => void toggleAutoStart(cap, enabled)}
              onOpenDiagnose={() => setDiagnoseOpen(true)}
            />
          );
        })}
        {/* OCR sidecar — 不在 useLocalRuntimeStore 管的 5 个 capability 内
            (那个管 llama/whisper/Infinity 三类 sidecar 的 SidecarRuntimeManager);
            RapidOCR 是独立的 python -m daemon,端口 18380,跟其它行视觉一致但走
            独立 API(modality.ocrSidecar.*)。后端 startup 已自动拉起一次。*/}
        <OcrSidecarRow />
        {/* PyTorch + torchvision — transformers image 链的硬依赖,wheel 体积
            ~250 MB(CPU)/ 2-3 GB(CUDA)不打包进 installer;启动后按需检测+安装。
            优先内置 wheel(无网兜底),没有 fallback 在线官方源。*/}
        <PytorchRow />
      </div>

      <DiagnoseModal open={diagnoseOpen} onOpenChange={setDiagnoseOpen} />
      <CallLogDialog open={callLogOpen} onOpenChange={setCallLogOpen} />
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
  isMissing: boolean;
  autoStart: boolean;
  autoStartPending: boolean;
  onChoose(id: string): void;
  onStart(): void;
  onStop(): void;
  onRestart(): void;
  onToggleAutoStart(enabled: boolean): void;
  onOpenDiagnose(): void;
}

const CapabilityRow: React.FC<CapabilityRowProps> = ({
  capability,
  label,
  status,
  pending,
  models,
  resolvedModelId,
  isMissing,
  autoStart,
  autoStartPending,
  onChoose,
  onStart,
  onStop,
  onRestart,
  onToggleAutoStart,
  onOpenDiagnose,
}) => {
  const state = status?.state ?? 'stopped';
  const isPending = pending !== null;
  const isReady = state === 'ready';
  const isFailed = state === 'failed';
  const noModels = models.length === 0;

  const selectedId = resolvedModelId ?? '';

  return (
    <div
      id={`local-runtime-${capability}`}
      className="rounded-md border border-[var(--cy-border-subtle)] p-3 space-y-1.5 scroll-mt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <LocalRuntimeStatusBadge status={status} />
        <span className="text-sm font-medium text-[var(--cy-text-primary)]">{label}</span>
        {isMissing && (
          <span
            className="rounded-sm border border-amber-400/50 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            title="该能力未随当前安装包嵌入,需先在「模型广场」下载模型"
          >
            未随包
          </span>
        )}
        {isReady && status?.endpoint && (
          <code className="text-xs text-[var(--cy-text-secondary)]">{status.endpoint}</code>
        )}
        {isReady && status?.pid != null && (
          <span className="text-xs text-[var(--cy-text-tertiary)]">pid {status.pid}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--cy-text-tertiary)]">模型</label>
        <select
          value={selectedId}
          onChange={(e) => onChoose(e.target.value)}
          disabled={noModels || isPending}
          // ⚠ max-w + truncate:原生 <select> 在 Chromium / WebView2 上的下拉
          // 宽度由"最长 option 文本"撑;像 jinaai/jina-clip-v2(420.5 MB)
          // 这种字符串会让 select 整体撑爆,在窄面板里直接超出页面。这里
          // 限定 select 自身最大 14rem,option 文本走 _shortModelLabel 去掉
          // org/ 前缀只显模型短名 — 完整 id 还是作为 value
          className="max-w-[14rem] truncate rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
          title={selectedId || ''}
        >
          {noModels ? (
            <option value="">未安装,前往「模型广场」下载</option>
          ) : (
            models.map((m) => (
              <option key={m.model_id} value={m.model_id} title={m.model_id}>
                {_shortModelLabel(m.model_id)}
                {m.size_bytes ? ` · ${prettyMB(m.size_bytes)}` : ''}
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

      <div className="flex items-center justify-between gap-3 pt-1">
        <label
          htmlFor={`auto-start-${capability}`}
          className="flex flex-col gap-0.5 cursor-pointer select-none"
          title="开启:chayuan-server 启动时自动拉起;关闭:需手动点上方「启动」"
        >
          <span className="text-xs font-medium text-[var(--cy-text-primary)]">
            随 chayuan-server 自动启动
          </span>
          <span className="text-[10px] text-[var(--cy-text-tertiary)]">
            切换不影响当前进程,只决定下次 chayuan-server 启动行为
          </span>
        </label>
        <Switch
          id={`auto-start-${capability}`}
          checked={autoStart}
          disabled={autoStartPending}
          onCheckedChange={(checked) => onToggleAutoStart(Boolean(checked))}
        />
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

/**
 * 「OCR 文字识别 (RapidOCR)」行 — UI 风格跟前 5 个 CapabilityRow 一致,但走
 * 独立 API(modality.ocrSidecar.*)。不进 useLocalRuntimeStore 是因为 OCR
 * sidecar 是独立的 python -m daemon,SidecarRuntimeManager 不管它。
 *
 * 状态色复用 LocalRuntimeStatusBadge 的配色规则,但用 inline JSX 实现以避免
 * 跟 LocalRuntimeStatus 类型耦合。
 */
const OcrSidecarRow: React.FC = () => {
  const [status, setStatus] = React.useState<OcrSidecarStatus | null>(null);
  const [pending, setPending] = React.useState<'start' | 'stop' | 'autostart' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const s = await modality.ocrSidecar.status();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    // 5s 轮询 — 跟 LocalRuntimePanel 的 statuses 轮询节奏对齐
    const t = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const onStart = async () => {
    setPending('start');
    try {
      const s = await modality.ocrSidecar.start();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };
  const onStop = async () => {
    setPending('stop');
    try {
      const s = await modality.ocrSidecar.stop();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };
  const onToggleAutoStart = async (enabled: boolean) => {
    setPending('autostart');
    try {
      const s = await modality.ocrSidecar.setAutoStart(enabled);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const state = status?.state ?? 'stopped';
  const isReady = state === 'ready';
  const isStarting = state === 'starting';
  const isFailed = state === 'failed';
  const isPending = pending !== null;
  const stateLabel = isReady ? '运行中' : isStarting ? '启动中' : isFailed ? '失败' : '已停止';
  const stateColor =
    isReady
      ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
      : isStarting
        ? 'bg-sky-500/15 text-sky-700 border-sky-500/30 animate-pulse'
        : isFailed
          ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
          : 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30';
  const dotColor =
    isReady ? 'bg-emerald-500'
      : isStarting ? 'bg-sky-500'
        : isFailed ? 'bg-rose-500' : 'bg-zinc-400';

  return (
    <div
      id="local-runtime-ocr"
      className="rounded-md border border-[var(--cy-border-subtle)] p-3 space-y-1.5 scroll-mt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          title={status?.error || stateLabel}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${stateColor}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          {stateLabel}
        </span>
        <span className="text-sm font-medium text-[var(--cy-text-primary)]">
          OCR 文字识别
        </span>
        <span
          className="rounded-sm border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          title="独立 Python daemon,端口 18380;chayuan-server 启动时自动拉起"
        >
          RapidOCR · 18380
        </span>

        <div className="ml-auto flex items-center gap-1">
          {isReady ? (
            <Button size="sm" variant="outline" onClick={onStop} disabled={isPending}>
              <Square className="mr-1 h-3.5 w-3.5" />
              {pending === 'stop' ? '停止中…' : '停止'}
            </Button>
          ) : (
            <Button size="sm" onClick={onStart} disabled={isPending}>
              <Play className="mr-1 h-3.5 w-3.5" />
              {pending === 'start' ? '启动中…' : '启动'}
            </Button>
          )}
          {isReady && (
            <Button size="sm" variant="outline" onClick={onStart} disabled={isPending}>
              <RotateCw className="mr-1 h-3.5 w-3.5" />
              重启
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <label
          htmlFor="ocr-auto-start"
          className="flex flex-col gap-0.5 cursor-pointer select-none"
          title="开启:chayuan-server 启动时一并拉起 RapidOCR daemon;关闭:需要手动点上方启动"
        >
          <span className="text-xs font-medium text-[var(--cy-text-primary)]">
            随 chayuan-server 自动启动
          </span>
          <span className="text-[10px] text-[var(--cy-text-tertiary)]">
            关闭后重启 chayuan-server 不会拉起 OCR,需手动点上方「启动」
          </span>
        </label>
        <Switch
          id="ocr-auto-start"
          checked={status?.auto_start ?? true}
          disabled={pending === 'autostart' || status == null}
          onCheckedChange={(checked) => void onToggleAutoStart(Boolean(checked))}
        />
      </div>

      <div className="text-[11px] text-[var(--cy-text-tertiary)] space-y-0.5">
        {status?.pid && <div>pid={status.pid} · 端口 {status.port}</div>}
        {status?.log_path && (
          <div className="font-mono break-all">日志:{status.log_path}</div>
        )}
        {error && (
          <div className="text-rose-600 dark:text-rose-400">{error}</div>
        )}
        {status?.error && !error && (
          <div className="text-rose-600 dark:text-rose-400">{status.error}</div>
        )}
      </div>
    </div>
  );
};

/**
 * 「PyTorch」行 — 显示 torch/torchvision 版本 + GPU 检测 + 一键安装。
 *
 * 设计:transformers image 链的硬依赖,wheel 体积大不打包进 installer。
 *   - import_ok=true:显示已就绪(绿)+ 版本号
 *   - import_ok=false:显示需安装(灰/红)+ 提供安装按钮
 *   - 安装时:disable 按钮 + 显示最近几行 log + 提示装完需重启 chayuan-server
 *   - 优先内置 wheel(offline_wheels_available=true,无网也能装);否则在线
 */
const PytorchRow: React.FC = () => {
  const [status, setStatus] = React.useState<PytorchStatus | null>(null);
  const [task, setTask] = React.useState<PytorchInstallTask | null>(null);
  const [installing, setInstalling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refreshStatus = React.useCallback(async () => {
    try {
      setStatus(await localRuntime.pytorchStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  React.useEffect(() => {
    void refreshStatus();
    const t = window.setInterval(() => void refreshStatus(), 5_000);
    return () => window.clearInterval(t);
  }, [refreshStatus]);

  // 安装中:轮询 task,直到 terminal state
  React.useEffect(() => {
    if (!task || !installing) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const t = await localRuntime.pytorchInstallTask(task.task_id);
          setTask(t);
          if (['done', 'failed', 'cancelled'].includes(t.state)) {
            setInstalling(false);
            await refreshStatus();
            return;
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setInstalling(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [task, installing, refreshStatus]);

  const startInstall = async (variant: PytorchVariant) => {
    setError(null);
    setInstalling(true);
    setTask(null);
    try {
      const t = await localRuntime.pytorchInstall(variant);
      setTask(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };

  const isReady = status?.import_ok === true;
  const stateLabel = isReady ? '就绪' : status ? '未就绪' : '检测中…';
  const stateColor =
    isReady
      ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
      : status
        ? 'bg-rose-500/15 text-rose-700 border-rose-500/30'
        : 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30';
  const dotColor = isReady ? 'bg-emerald-500' : status ? 'bg-rose-500' : 'bg-zinc-400';

  const variantLabel: Record<PytorchVariant, string> = {
    cpu: 'CPU',
    cu118: 'CUDA 11.8',
    cu121: 'CUDA 12.1',
    cu124: 'CUDA 12.4',
    cu126: 'CUDA 12.6',
    auto: '自动',
  };

  return (
    <div
      id="local-runtime-pytorch"
      className="rounded-md border border-[var(--cy-border-subtle)] p-3 space-y-1.5 scroll-mt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          title={status?.import_error || stateLabel}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${stateColor}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          {stateLabel}
        </span>
        <span className="text-sm font-medium text-[var(--cy-text-primary)]">
          PyTorch
        </span>
        {status?.has_nvidia_gpu && (
          <span
            className="rounded-sm border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
            title={`检测到 NVIDIA GPU,驱动 ${status.nvidia_driver ?? '未知'}`}
          >
            GPU
          </span>
        )}
        {status?.offline_wheels_available && (
          <span
            className="rounded-sm border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-200"
            title={`内置 wheel 可用 ${status.offline_wheels_dir ?? ''}`}
          >
            离线 wheel 就绪
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {!isReady && status?.can_install !== false && (
            <>
              <Button
                size="sm"
                onClick={() => void startInstall(status?.suggested_variant ?? 'auto')}
                disabled={installing}
              >
                {installing
                  ? '安装中…'
                  : `安装 ${variantLabel[status?.suggested_variant ?? 'auto']}`}
              </Button>
              {status?.has_nvidia_gpu && status?.suggested_variant !== 'cpu' && !installing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void startInstall('cpu')}
                  title="跳过 CUDA,只装 CPU 版(小,无 GPU 加速)"
                >
                  装 CPU 版
                </Button>
              )}
            </>
          )}
          {isReady && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void startInstall(status?.suggested_variant ?? 'auto')}
              disabled={installing}
              title="重装(本机版本异常 / 升级 wheel 时用)"
            >
              重装
            </Button>
          )}
        </div>
      </div>

      <div className="text-[11px] text-[var(--cy-text-tertiary)] space-y-0.5">
        {status && (
          <div>
            torch: {status.torch_version ?? '未安装'}
            {status.torch_cuda_build && ` (${status.torch_cuda_build})`}
            {' · '}
            torchvision: {status.torchvision_version ?? '未安装'}
          </div>
        )}
        {!isReady && status?.import_error && (
          <div className="text-rose-600 dark:text-rose-400 break-all">
            {status.import_error}
          </div>
        )}
        {status?.notes?.map((n, i) => (
          <div key={i} className="text-amber-700 dark:text-amber-300">{n}</div>
        ))}
        {error && (
          <div className="text-rose-600 dark:text-rose-400">{error}</div>
        )}
        {task && (
          <details className="mt-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-1.5"
                   open={installing}>
            <summary className="cursor-pointer text-xs text-[var(--cy-text-secondary)]">
              安装日志 · {task.recipe_label} · {task.state}
              {task.state === 'done' && ' ✓ 装完请重启 chayuan-server 才能生效'}
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px]
                            font-mono text-[var(--cy-text-tertiary)]">
              {task.log.slice(-30).join('\n') || '(等待日志…)'}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

function prettyMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** 模型短名:去掉 ``org/`` 前缀只保留 repo 名,过长再截。
 *  HF 模型 id 经常 30+ 字符(jinaai/jina-embeddings-v3 / google/siglip2-base-
 *  patch16-224),原生 <select> 在 Chromium / WebView2 上会按最长 option 撑出宽度,
 *  窄面板里超出视口。完整 id 还是 option value / title,只显示截短。 */
function _shortModelLabel(id: string): string {
  if (!id) return '';
  const tail = id.includes('/') ? (id.split('/').pop() ?? id) : id;
  // GGUF 量化后缀往往最长,优先去掉
  const stripped = tail.replace(/-(GGUF|gguf|Q\d_[A-Z0-9_]+)$/, '');
  return stripped.length > 32 ? stripped.slice(0, 30) + '…' : stripped;
}

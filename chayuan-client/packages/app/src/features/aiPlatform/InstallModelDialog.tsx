/**
 * "本地模型服务"行内"下载模型"入口的 Dialog。
 *
 * 用户故事
 * ========
 *
 * 用户在设置页看到「聊天」cap 的本地模型服务 state=stopped(因为没装模型),
 * 点该行右侧的「下载模型」按钮 → 这个 Dialog 弹出。
 *
 * Dialog 提供两种途径:
 *
 *   1. **去 ModelScope 搜模型 + 粘贴 model_id 下载**(主路径)
 *      - 标题:在 ModelScope 搜 <cap-推荐关键字>
 *      - 「打开 modelscope.cn」按钮(用 shell.openExternal,WebView 不允许 window.open)
 *      - 输入框:粘贴 model_id(``owner/name``)
 *      - 可选输入:specific_file(GGUF 多 quant 仓库挑一个,如 ``Q4_K_M.gguf``)
 *      - 「开始下载」→ POST /admin/models/install_model 返回 job_id → 每 2s 轮询
 *      - 进度条 + log_tail 显示
 *      - 成功 → 提示"已下载并自动启动" + onSuccess() 让父组件刷新模型下拉
 *
 *   2. **手动放好模型,扫描挂载**(备用路径)
 *      - 展示 ``<CHAYUAN_ROOT>/models/bundled/<cap>/`` 真实绝对路径
 *      - 复制按钮 + 提示"把模型文件复制到这里,然后点下面"
 *      - 「我已放好,扫描挂载」→ POST /admin/models/scan_and_mount
 *      - 后端 scan_once + 自动 start 新发现的 cap
 *      - 完成 → 列出 ``scan_delta`` + ``auto_started`` + onSuccess()
 *
 * 跟 BootstrapBanner 的区别
 * ========================
 *
 * BootstrapBanner 已删除 — 它强推 release 整包,用户没自主权;这个 Dialog
 * 是 cap-粒度的自主入口,用户挑模型、挑源、决定何时下,UI 更直接也更克制。
 */
import * as React from 'react';
import { Copy, ExternalLink, FolderOpen, Loader2, RotateCw } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@chayuan/ui';
import {
  type InstallModelCapability,
  type InstallModelJob,
  type InstallModelSource,
  type LocalRuntimeCapability,
  type ScanAndMountResult,
  serverModelsInstallModel,
  serverModelsScanAndMount,
} from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { notifySuccess, reportError } from '../../store/errorDialog';

export interface InstallModelDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 当前 cap(LocalRuntimeServicesSection 用的短名:chat/embedding/...);
   *  会被映射成 catalog 长名传给后端。 */
  capability: LocalRuntimeCapability;
  /** 下载成功 / 扫描挂载成功后回调,让父组件重拉模型下拉 + 状态徽章。 */
  onSuccess?(): void;
}

// LocalRuntimeServicesSection 短名 → backend catalog 长名
const CAP_TO_CATALOG: Record<LocalRuntimeCapability, InstallModelCapability> = {
  chat: 'chat',
  embedding: 'text-embedding',
  rerank: 'rerank',
  asr: 'speech-to-text',
  'image-embedding': 'image-embedding',
};

const CAP_LABEL: Record<LocalRuntimeCapability, string> = {
  chat: '聊天模型',
  embedding: '文本向量模型',
  rerank: '重排模型',
  asr: '语音识别模型',
  'image-embedding': '图像向量模型',
};

// 按 cap 给出 ModelScope 上比较合适的搜索关键字 + 1-2 个示例 model_id。
// 例:chat → "Qwen GGUF" 比单 "chat" 命中更准(都是 LLM 标"对话")。
// 这里的 example 是为了让用户对"该填什么"有第一印象,不是强推。
const CAP_HINTS: Record<
  LocalRuntimeCapability,
  { search: string; examples: string[]; note: string }
> = {
  chat: {
    search: 'Qwen GGUF',
    examples: [
      'Qwen/Qwen3-4B-Instruct-2507-GGUF',
      'unsloth/Qwen3-4B-Instruct-2507-GGUF',
    ],
    note: '推荐 GGUF 量化格式,体积小,llama.cpp 直接加载',
  },
  embedding: {
    search: 'bge gte',
    examples: ['BAAI/bge-m3', 'iic/nlp_gte_sentence-embedding_chinese-base'],
    note: '推荐 BGE / GTE 系列;multi-lingual 选 bge-m3 或 gte-multilingual',
  },
  rerank: {
    search: 'bge reranker GGUF',
    examples: [
      'BAAI/bge-reranker-v2-m3',
      'gpustack/bge-reranker-v2-m3-GGUF',
    ],
    note: '推荐 GGUF 格式;HF transformer 仓需要 PyTorch 占内存',
  },
  asr: {
    search: 'whisper',
    examples: ['ggerganov/whisper.cpp', 'Systran/faster-whisper-base'],
    note: '推荐 whisper.cpp ggml 格式(单文件),如 ``ggml-tiny.bin``',
  },
  'image-embedding': {
    search: 'CLIP jina-clip',
    examples: ['jinaai/jina-clip-v2', 'OFA-Sys/chinese-clip-vit-base-patch16'],
    note: 'CLIP 系列,做图文检索;transformers 库加载',
  },
};

function modelscopeSearchURL(keyword: string): string {
  return `https://modelscope.cn/models?name=${encodeURIComponent(keyword)}`;
}

export const InstallModelDialog: React.FC<InstallModelDialogProps> = ({
  open,
  onOpenChange,
  capability,
  onSuccess,
}) => {
  const hint = CAP_HINTS[capability];
  const [source, setSource] = React.useState<InstallModelSource>('modelscope');
  const [modelId, setModelId] = React.useState('');
  const [specificFile, setSpecificFile] = React.useState('');
  const [job, setJob] = React.useState<InstallModelJob | null>(null);
  const [scanResult, setScanResult] = React.useState<ScanAndMountResult | null>(null);
  const [pending, setPending] = React.useState<'install' | 'scan' | null>(null);
  const [bundledRoot, setBundledRoot] = React.useState<string>('');

  // 打开 Dialog 时重置临时状态(保留 source/modelId 偏好以防用户失误关闭)
  React.useEffect(() => {
    if (!open) {
      setJob(null);
      setScanResult(null);
      setPending(null);
    }
  }, [open]);

  // 轮询 job 状态:running 时每 2s 拉一次
  React.useEffect(() => {
    if (!job || !pending) return;
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      setPending(null);
      if (job.status === 'succeeded') {
        notifySuccess('模型下载完成', job.target_dir || '已落入本地模型目录');
        onSuccess?.();
      }
      return;
    }
    const tid = window.setTimeout(async () => {
      try {
        const fresh = await serverModelsInstallModel.get(job.id);
        setJob(fresh);
      } catch (e) {
        reportError('查询下载进度失败', e instanceof Error ? e.message : String(e));
        setPending(null);
      }
    }, 2000);
    return () => window.clearTimeout(tid);
  }, [job, pending, onSuccess]);

  const onStartInstall = async () => {
    const id = modelId.trim();
    if (!id) {
      reportError('请输入 model_id', '形如 owner/name,例如 ' + (hint.examples[0] ?? ''));
      return;
    }
    setPending('install');
    setScanResult(null);
    try {
      const j = await serverModelsInstallModel.start({
        source,
        model_id: id,
        capability: CAP_TO_CATALOG[capability],
        specific_file: specificFile.trim() || null,
      });
      setJob(j);
    } catch (e) {
      reportError('启动下载失败', e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  };

  const onCancelInstall = async () => {
    if (!job) return;
    try {
      const j = await serverModelsInstallModel.cancel(job.id);
      setJob(j);
    } catch (e) {
      reportError('取消失败', e instanceof Error ? e.message : String(e));
    }
  };

  const onScanAndMount = async () => {
    setPending('scan');
    setJob(null);
    try {
      const r = await serverModelsScanAndMount.invoke();
      setScanResult(r);
      setBundledRoot(r.bundled_root);
      if (r.scan_delta.added + r.scan_delta.updated > 0 || r.auto_started.length > 0) {
        notifySuccess(
          '扫描完成',
          `发现 ${r.scan_delta.added} 个新模型;启动了 ${r.auto_started.length} 个 cap`,
        );
        onSuccess?.();
      }
    } catch (e) {
      reportError('扫描失败', e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  // 进 Dialog 时先尝试拿一次 bundled_root(免触发 scan,直接读后端拼好的路径)
  // 走 scan_and_mount 同接口最简单,但它会真的扫盘,稍慢。这里 lazy:用户点
  // 「打开本地模型目录」时再触发,或者第一次 scan 时一并填上。
  // 为了让"复制路径"按钮也能用,这里在 open 后做一次 lightweight scan(0 改动场景很快)。
  React.useEffect(() => {
    if (!open || bundledRoot) return;
    void serverModelsScanAndMount
      .invoke()
      .then((r) => setBundledRoot(r.bundled_root))
      .catch(() => {});
  }, [open, bundledRoot]);

  const isBusy = pending !== null;
  const installRunning =
    job && (job.status === 'queued' || job.status === 'running');
  const installDone = job?.status === 'succeeded';
  const installFailed = job?.status === 'failed' || job?.status === 'cancelled';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>下载{CAP_LABEL[capability]}</DialogTitle>
          <DialogDescription>
            从 ModelScope(国内)或 Hugging Face 拉一个模型到本地,装完即用。
            或者你已经手动下好了文件,用下面的「扫描挂载」一键识别。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ─────── 路径 A:在线下载 ─────── */}
          <section className="space-y-2 rounded-md border border-[var(--cy-border-subtle)] p-3">
            <div className="text-sm font-medium">方式 1:在线下载</div>
            <div className="text-xs text-[var(--cy-text-tertiary)]">
              在 ModelScope 找到一个模型(推荐关键字:
              <code className="rounded bg-[var(--cy-surface-elev1)] px-1">{hint.search}</code>
              )→ 复制它的 model_id(形如 ``owner/name``)粘到下方。
              {hint.note}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void getPlatform().shell.openExternal(modelscopeSearchURL(hint.search))
                }
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                打开 ModelScope 搜索
              </Button>
              <span className="text-xs text-[var(--cy-text-tertiary)]">示例:</span>
              {hint.examples.map((eg) => (
                <button
                  key={eg}
                  type="button"
                  className="rounded border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--cy-surface-elev1)]"
                  onClick={() => setModelId(eg)}
                  title="点击填到下方"
                >
                  {eg}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
              <label className="text-xs text-[var(--cy-text-tertiary)]">来源</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as InstallModelSource)}
                disabled={isBusy}
                className="w-32 rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
              >
                <option value="modelscope">ModelScope(国内)</option>
                <option value="huggingface">Hugging Face(走 hf-mirror)</option>
              </select>

              <label className="text-xs text-[var(--cy-text-tertiary)]">model_id</label>
              <Input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={hint.examples[0] ?? 'owner/name'}
                disabled={isBusy}
              />

              <label
                className="text-xs text-[var(--cy-text-tertiary)]"
                title="GGUF 多 quant 仓库挑一个 .gguf 文件;HF transformers 仓库留空"
              >
                单文件(可选)
              </label>
              <Input
                value={specificFile}
                onChange={(e) => setSpecificFile(e.target.value)}
                placeholder="留空 = 整仓 snapshot(transformers / sentence-transformers)"
                disabled={isBusy}
              />
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={onStartInstall} disabled={isBusy || !modelId.trim()}>
                {pending === 'install' ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                开始下载
              </Button>
              {installRunning && (
                <Button size="sm" variant="outline" onClick={() => void onCancelInstall()}>
                  取消下载
                </Button>
              )}
            </div>

            {job && (
              <div className="rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-elev1)] p-2 text-xs">
                <div className="font-mono">
                  status={job.status} · step={job.step} · {job.progress_pct.toFixed(1)}%
                </div>
                {job.progress_message && (
                  <div className="mt-1 text-[var(--cy-text-secondary)]">{job.progress_message}</div>
                )}
                {/* 进度条 */}
                <div className="mt-2 h-1.5 w-full rounded bg-[var(--cy-surface-base)]">
                  <div
                    className="h-1.5 rounded bg-emerald-500 transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, job.progress_pct))}%` }}
                  />
                </div>
                {installDone && (
                  <div className="mt-2 text-emerald-700 dark:text-emerald-300">
                    ✓ 完成,落到:<code>{job.target_dir}</code>
                  </div>
                )}
                {installFailed && (
                  <div className="mt-2 text-rose-700 dark:text-rose-300">
                    ✗ {job.status};查看日志:
                    <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-rose-50 p-1.5 text-[10px] dark:bg-rose-950/30">
                      {job.log_tail.slice(-10).join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ─────── 路径 B:手动放好,扫描挂载 ─────── */}
          <section className="space-y-2 rounded-md border border-[var(--cy-border-subtle)] p-3">
            <div className="text-sm font-medium">方式 2:我已经下好了文件,扫描挂载</div>
            <div className="text-xs text-[var(--cy-text-tertiary)]">
              如果你已经从其它来源拿到了模型文件(GGUF / safetensors / 整个 HF 仓库),
              请把它们放到下面这个目录,然后点「扫描挂载」,后端会自动识别并启动对应服务。
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-[var(--cy-border-default)] bg-[var(--cy-surface-elev1)] px-2 py-1 text-xs">
                {bundledRoot || '(载入中…)'}
              </code>
              <Button
                size="sm"
                variant="outline"
                disabled={!bundledRoot}
                onClick={() => {
                  if (bundledRoot) {
                    void navigator.clipboard?.writeText(bundledRoot);
                    notifySuccess('已复制路径', bundledRoot);
                  }
                }}
                title="复制目录路径"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!bundledRoot}
                onClick={() => {
                  // Tauri shell.open 可以打开文件夹(open + file:// URI)
                  // 不同平台资源管理器名字不同,统一交给 platform 处理
                  if (bundledRoot) {
                    void getPlatform().shell.openExternal(`file://${bundledRoot}`);
                  }
                }}
                title="用资源管理器打开"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="text-[11px] text-[var(--cy-text-tertiary)]">
              提示:在 {CAP_LABEL[capability]} 行,把文件放到子目录{' '}
              <code className="bg-[var(--cy-surface-elev1)] px-1">
                {bundledRoot ? `${bundledRoot.replace(/[/\\]+$/, '')}/${capability === 'embedding' ? 'embedding' : capability === 'asr' ? 'asr' : capability === 'image-embedding' ? 'image' : capability}/` : `<bundled>/${capability}/`}
              </code>
              下,scanner 会按目录关键字识别 capability。
            </div>

            <Button size="sm" onClick={() => void onScanAndMount()} disabled={isBusy}>
              {pending === 'scan' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCw className="mr-1 h-3.5 w-3.5" />
              )}
              我已放好,扫描挂载
            </Button>

            {scanResult && (
              <div className="rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-elev1)] p-2 text-xs">
                扫描完成:新增 {scanResult.scan_delta.added} · 更新{' '}
                {scanResult.scan_delta.updated} · 删除 {scanResult.scan_delta.removed}
                {scanResult.auto_started.length > 0 && (
                  <div className="mt-1 text-emerald-700 dark:text-emerald-300">
                    ✓ 已自动启动 cap:{scanResult.auto_started.join(', ')}
                  </div>
                )}
                {scanResult.scan_delta.added === 0 &&
                  scanResult.scan_delta.updated === 0 && (
                    <div className="mt-1 text-[var(--cy-text-tertiary)]">
                      没扫到新模型 — 确认文件是否真的放到了 {capability}/ 子目录?
                    </div>
                  )}
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

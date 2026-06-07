/**
 * AI 视频生成页（文生视频 / 图生视频）。
 *
 * 调用 @chayuan/api 的 aiVideoListModels() 填充模型下拉，
 * aiVideoGenerate() 提交请求并通过 SSE 流式回调展示进度 / 结果。
 * 按次门控：gate.guard() 通过后才真正发起生成。
 * 左侧表单 + 右侧结果，复用 var(--cy-*) 主题变量 + @chayuan/ui 控件。
 */
import * as React from 'react';
import { Loader2, Film, Download, AlertTriangle, CircleCheck } from 'lucide-react';
import { aiVideoGenerate, aiVideoListModels } from '@chayuan/api';
import { Button, Textarea, cn } from '@chayuan/ui';
import { useUsageGate, UsageGateDialogs } from '../license';

// ────────────────────────────────────────────────────────────────
// 常量选项
// ────────────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
];

const RESOLUTION_OPTIONS = [
  { value: '480p', label: '480P' },
  { value: '720p', label: '720P' },
  { value: '1080p', label: '1080P' },
];

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
];

// ────────────────────────────────────────────────────────────────
// 辅助：将 File 转 base64（去掉 data:...;base64, 前缀）
// ────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<{ b64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result 形如 "data:image/png;base64,AAAA..."
      const commaIdx = result.indexOf(',');
      const b64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ b64, mime: file.type || 'image/png' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ────────────────────────────────────────────────────────────────
// 简单 Select（避免引入未导出的 Select 组件）
// ────────────────────────────────────────────────────────────────

const NativeSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}> = ({ value, onChange, options, disabled, className }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className={cn(
      'h-8 w-full rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-1)] px-2 text-sm text-[var(--cy-text-primary)]',
      'focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

// ────────────────────────────────────────────────────────────────
// 进度条组件（复用 RenderProgressCard 视觉风格）
// ────────────────────────────────────────────────────────────────

const ProgressBar: React.FC<{ percent: number }> = ({ percent }) => (
  <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5">
    <div className="flex items-center gap-2 text-xs">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--cy-brand-500)]" />
      <span className="text-[var(--cy-text-secondary)]">生成中…</span>
      <span className="ml-auto tabular-nums text-[var(--cy-text-tertiary)]">{percent}%</span>
    </div>
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--cy-surface-2)]">
      <div
        className="h-full bg-[var(--cy-brand-500)] transition-all"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────────
// 主页组件
// ────────────────────────────────────────────────────────────────

type GenState = 'idle' | 'busy' | 'done' | 'error';

export const AiVideoPage: React.FC = () => {
  // 模型列表
  const [models, setModels] = React.useState<Array<{ platform: string; model: string }>>([]);
  const [modelsLoading, setModelsLoading] = React.useState(true);

  // 表单字段
  const [selectedModel, setSelectedModel] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState('5');
  const [resolution, setResolution] = React.useState('720p');
  const [ratio, setRatio] = React.useState('16:9');

  // 生成状态
  const [genState, setGenState] = React.useState<GenState>('idle');
  const [progress, setProgress] = React.useState(0);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // AbortController：组件卸载 / 用户取消时 abort
  const abortCtlRef = React.useRef<AbortController | null>(null);

  // 按次门控
  const gate = useUsageGate('video');

  // ── 加载模型列表 ──────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    aiVideoListModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        const first = list[0];
        if (first) {
          setSelectedModel(`${first.platform}::${first.model}`);
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 组件卸载时 abort ──────────────────────────────────────────
  React.useEffect(() => {
    return () => {
      abortCtlRef.current?.abort();
    };
  }, []);

  // ── 首帧图上传处理 ────────────────────────────────────────────
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  };

  // ── 生成 ──────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedModel || !prompt.trim()) return;

    await gate.guard(async () => {
      // 解析 platform::model
      const sepIdx = selectedModel.indexOf('::');
      const modelId = sepIdx >= 0 ? selectedModel.slice(sepIdx + 2) : selectedModel;

      // 处理首帧图
      let imageB64: string | null = null;
      let imageMime: string | null = null;
      if (imageFile) {
        const r = await fileToBase64(imageFile);
        imageB64 = r.b64;
        imageMime = r.mime;
      }

      // 构造参数
      const params = {
        model: modelId,
        prompt: prompt.trim(),
        imageB64,
        imageMime,
        modalityParams: {
          duration: Number(duration),
          resolution,
          ratio,
        },
      };

      // 重置状态
      setGenState('busy');
      setProgress(0);
      setVideoUrl(null);
      setErrorMsg(null);

      // 新建 AbortController
      const ctl = new AbortController();
      abortCtlRef.current?.abort();
      abortCtlRef.current = ctl;

      try {
        await aiVideoGenerate(
          params,
          {
            onProgress: (pct) => setProgress(pct),
            onVideo: (url) => {
              setVideoUrl(url);
              setGenState('done');
            },
            onError: (e) => {
              setErrorMsg(e.message);
              setGenState('error');
            },
            onDone: () => {
              setGenState((prev) => (prev === 'busy' ? 'done' : prev));
            },
          },
          { signal: ctl.signal },
        );
      } catch (e: unknown) {
        if ((e as { name?: string }).name === 'AbortError') return;
        setErrorMsg(e instanceof Error ? e.message : '未知错误');
        setGenState('error');
      }
    });
  };

  const handleCancel = () => {
    abortCtlRef.current?.abort();
    setGenState('idle');
    setProgress(0);
  };

  const busy = genState === 'busy';

  // ── 模型下拉选项 ──────────────────────────────────────────────
  const modelOptions = models.map((m) => ({
    value: `${m.platform}::${m.model}`,
    label: `${m.platform} / ${m.model}`,
  }));

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--cy-surface-base)]">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-5 py-3">
        <Film className="h-4 w-4 text-[var(--cy-brand-500)]" />
        <h1 className="text-sm font-semibold text-[var(--cy-text-primary)]">AI 视频生成</h1>
      </div>

      {/* 主体：左表单 + 右结果 */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-5">
        {/* ── 左侧表单 ── */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto">
          {/* 模型 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">生成模型</label>
            {modelsLoading ? (
              <div className="flex h-8 items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载中…
              </div>
            ) : modelOptions.length === 0 ? (
              <p className="text-xs text-[var(--cy-text-tertiary)]">
                暂无可用文生视频模型，请在模型厂商中配置。
              </p>
            ) : (
              <NativeSelect
                value={selectedModel}
                onChange={setSelectedModel}
                options={modelOptions}
                disabled={busy}
              />
            )}
          </div>

          {/* 提示词 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的视频内容…"
              rows={4}
              disabled={busy}
              className="resize-none text-sm"
            />
          </div>

          {/* 首帧图（可选） */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">
              首帧参考图
              <span className="ml-1 font-normal text-[var(--cy-text-tertiary)]">（可选）</span>
            </label>
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={handleImageChange}
              className="text-xs text-[var(--cy-text-secondary)] file:mr-2 file:cursor-pointer file:rounded file:border file:border-[var(--cy-border-default)] file:bg-[var(--cy-surface-1)] file:px-2 file:py-0.5 file:text-xs file:text-[var(--cy-text-primary)] file:hover:bg-[var(--cy-surface-2)]"
            />
            {imagePreview && (
              <div className="relative mt-1 overflow-hidden rounded-lg border border-[var(--cy-border-subtle)]">
                <img src={imagePreview} alt="首帧预览" className="max-h-32 w-full object-cover" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/70"
                >
                  移除
                </button>
              </div>
            )}
          </div>

          {/* 时长 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">时长</label>
            <NativeSelect
              value={duration}
              onChange={setDuration}
              options={DURATION_OPTIONS}
              disabled={busy}
            />
          </div>

          {/* 分辨率 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">分辨率</label>
            <NativeSelect
              value={resolution}
              onChange={setResolution}
              options={RESOLUTION_OPTIONS}
              disabled={busy}
            />
          </div>

          {/* 比例 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">画面比例</label>
            <NativeSelect
              value={ratio}
              onChange={setRatio}
              options={RATIO_OPTIONS}
              disabled={busy}
            />
          </div>

          {/* 生成 / 取消按钮 */}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={() => void handleGenerate()}
              disabled={busy || !selectedModel || !prompt.trim() || modelsLoading}
              className="flex-1"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  生成中…
                </>
              ) : (
                '开始生成'
              )}
            </Button>
            {busy && (
              <Button variant="outline" onClick={handleCancel} className="shrink-0">
                取消
              </Button>
            )}
          </div>
        </div>

        {/* ── 右侧结果 ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {/* 空态 */}
          {genState === 'idle' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--cy-border-subtle)] text-center">
              <Film className="h-10 w-10 text-[var(--cy-text-tertiary)] opacity-40" />
              <p className="text-sm text-[var(--cy-text-tertiary)]">
                填写左侧表单后，点击「开始生成」
              </p>
            </div>
          )}

          {/* 生成中进度 */}
          {genState === 'busy' && (
            <div className="flex flex-1 flex-col gap-3">
              <ProgressBar percent={progress} />
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--cy-border-subtle)]">
                <p className="text-xs text-[var(--cy-text-tertiary)]">视频生成中，请稍候…</p>
              </div>
            </div>
          )}

          {/* 错误 */}
          {genState === 'error' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
              <AlertTriangle className="mr-1.5 inline h-4 w-4 text-rose-600" />
              生成失败：{errorMsg ?? '未知错误'}
            </div>
          )}

          {/* 完成：视频播放 + 下载 */}
          {(genState === 'done' || videoUrl) && videoUrl && (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1 text-xs text-emerald-700">
                <CircleCheck className="h-3.5 w-3.5" />
                生成完成
              </p>
              <div className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-black">
                <video
                  controls
                  src={videoUrl}
                  className={cn(
                    'w-full',
                    ratio === '9:16'
                      ? 'max-h-[70vh]'
                      : ratio === '1:1'
                        ? 'aspect-square'
                        : 'aspect-video',
                  )}
                  style={{ display: 'block' }}
                />
              </div>
              <a
                href={videoUrl}
                download
                className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--cy-border-default)] bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
              >
                <Download className="h-3.5 w-3.5" />
                下载视频
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 门控弹框（购买 / 分享） */}
      <UsageGateDialogs gate={gate} app="video" />
    </div>
  );
};

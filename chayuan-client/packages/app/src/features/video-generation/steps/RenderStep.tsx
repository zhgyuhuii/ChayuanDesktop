/**
 * Step 7 · 渲染(任务提交 + SSE 进度 + 成品播放)。
 *
 * 三态:
 *   idle      — 没活动任务,显示"开始合成"大按钮 + 任务参数摘要
 *   running   — 提交后订阅 SSE,圆环进度 + 当前步骤标签 + 取消按钮
 *   complete  — final_videos[] 渲染嵌入式 <video> + 下载 / 重新合成
 *   failed    — 错误信息 + 重试 / 回去检查参数
 *
 * 圆环进度用纯 CSS conic-gradient 实现,无第三方依赖。
 */
import * as React from 'react';
import { CirclePlay, Square, RefreshCw, Download, AlertTriangle, Sparkles } from 'lucide-react';
import {
  videoGeneration,
  vgTaskFileUrl,
  type VgTask,
} from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { reportError } from '../../../store/errorDialog';

const STEP_LABELS: Record<number, string> = {
  5: '准备',
  10: '生成脚本',
  20: '生成关键词',
  35: '语音合成',
  50: '字幕生成',
  70: '素材准备',
  95: '视频合成',
  100: '完成',
};

function progressLabel(progress: number): string {
  // 取小于等于 progress 的最大档位
  const thresholds = Object.keys(STEP_LABELS).map(Number).sort((a, b) => a - b);
  let label = STEP_LABELS[5];
  for (const t of thresholds) {
    if (progress >= t) label = STEP_LABELS[t];
  }
  return label || '处理中';
}

export const RenderStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const activeTaskId = useVgComposer((s) => s.activeTaskId);
  const setActiveTaskId = useVgComposer((s) => s.setActiveTaskId);
  const reset = useVgComposer((s) => s.reset);

  const [task, setTask] = React.useState<VgTask | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // ── SSE 订阅 ───────────────────────────────────────────────
  React.useEffect(() => {
    if (!activeTaskId) {
      setTask(null);
      return;
    }
    const ctl = new AbortController();
    void videoGeneration
      .subscribeTaskEvents(
        activeTaskId,
        { onTask: (t) => setTask(t) },
        { signal: ctl.signal },
      )
      .catch((e: Error) => {
        if (ctl.signal.aborted) return;
        reportError(e, '订阅任务进度失败');
      });
    return () => ctl.abort();
  }, [activeTaskId]);

  // ── 提交 ───────────────────────────────────────────────────
  const onSubmit = React.useCallback(async () => {
    setSubmitting(true);
    try {
      const t = await videoGeneration.submitTask(params, { stop_at: 'video' });
      setActiveTaskId(t.task_id);
      setTask(t);
    } catch (e) {
      reportError(e as Error, '提交任务失败');
    } finally {
      setSubmitting(false);
    }
  }, [params, setActiveTaskId]);

  const onCancel = React.useCallback(async () => {
    if (!activeTaskId) return;
    try {
      await videoGeneration.cancelTask(activeTaskId);
    } catch (e) {
      reportError(e as Error, '取消任务失败');
    }
  }, [activeTaskId]);

  const onRestart = React.useCallback(() => {
    setActiveTaskId(null);
    setTask(null);
  }, [setActiveTaskId]);

  const onNewTask = React.useCallback(() => {
    reset();
  }, [reset]);

  // 决定当前 UI 状态
  const state: 'idle' | 'running' | 'complete' | 'failed' | 'canceled' =
    !task ? 'idle'
    : task.state === 'complete' ? 'complete'
    : task.state === 'failed' ? 'failed'
    : task.state === 'canceled' ? 'canceled'
    : 'running';

  return (
    <div className="space-y-4">
      {state === 'idle' && <IdlePane onSubmit={onSubmit} submitting={submitting} params={params} />}
      {state === 'running' && task && <RunningPane task={task} onCancel={onCancel} />}
      {state === 'complete' && task && (
        <CompletePane task={task} onRestart={onRestart} onNewTask={onNewTask} />
      )}
      {state === 'failed' && task && (
        <FailedPane task={task} onRestart={onRestart} />
      )}
      {state === 'canceled' && (
        <div className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-6 text-center">
          <p className="text-sm text-[var(--cy-text-secondary)]">任务已取消</p>
          <button
            type="button"
            onClick={onRestart}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)]"
          >
            <RefreshCw className="h-4 w-4" /> 重新合成
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 子面板
// ─────────────────────────────────────────────────────────────────────

const IdlePane: React.FC<{
  params: ReturnType<typeof useVgComposer.getState>['params'];
  submitting: boolean;
  onSubmit: () => void;
}> = ({ params, submitting, onSubmit }) => {
  const summary: Array<[string, string]> = [
    ['内容来源', params.script_source === 'ai' ? 'AI 生成' : params.script_source === 'manual' ? '手写' : '粘贴字幕'],
    ['主题', params.video_subject || '(空)'],
    ['画幅', params.video_aspect],
    ['TTS', `${params.voice_provider} · ${params.voice_name || '默认'}`],
    ['字幕', params.subtitle_enabled ? `开 (${params.subtitle_position})` : '关'],
    ['BGM', params.bgm_type === 'none' ? '无' : params.bgm_type === 'random' ? '随机' : params.bgm_file || '未选'],
    ['数量', `${params.video_count} 份`],
    ['素材', params.video_materials?.length ? `${params.video_materials.length} 段` : '自动选择'],
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5">
        <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">提交确认</h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {summary.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-[var(--cy-text-tertiary)]">{k}</dt>
              <dd className="truncate text-[var(--cy-text-secondary)]" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-6 py-3 text-base font-medium text-white shadow transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Sparkles className="h-5 w-5 animate-pulse" /> 提交中…
          </>
        ) : (
          <>
            <CirclePlay className="h-5 w-5" /> 开始合成视频
          </>
        )}
      </button>
    </div>
  );
};

const RunningPane: React.FC<{ task: VgTask; onCancel: () => void }> = ({ task, onCancel }) => {
  const progress = task.progress;
  const label = progressLabel(progress);
  return (
    <div className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-8 text-center">
      <div
        className="mx-auto h-40 w-40 rounded-full"
        style={{
          background: `conic-gradient(var(--cy-brand-500) ${progress * 3.6}deg, var(--cy-surface-2) 0)`,
        }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[var(--cy-surface-base)] m-2 shadow-inner" style={{ height: 'calc(100% - 16px)', width: 'calc(100% - 16px)' }}>
          <p className="text-3xl font-bold text-[var(--cy-text-primary)]">{progress}%</p>
          <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">{label}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-[var(--cy-text-secondary)]">正在合成视频,可在素材库 / 我的视频继续浏览</p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-4 py-1.5 text-xs text-[var(--cy-text-secondary)] hover:border-rose-300 hover:text-rose-600"
      >
        <Square className="h-3.5 w-3.5" /> 取消任务
      </button>
    </div>
  );
};

const CompletePane: React.FC<{
  task: VgTask;
  onRestart: () => void;
  onNewTask: () => void;
}> = ({ task, onRestart, onNewTask }) => {
  const videos = task.result?.final_videos ?? [];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="text-base font-semibold text-emerald-900">合成完成 · 共 {videos.length} 份</p>
        <p className="mt-1 text-xs text-emerald-700">点击下方视频试看;或到「我的视频」长期保存查看</p>
      </div>

      {videos.length === 0 && (
        <p className="text-sm text-[var(--cy-text-tertiary)]">结果列表为空 — 可能合成失败,详见 result_json</p>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {videos.map((p, i) => {
          const name = p.split(/[\\/]/).pop() || `final-${i + 1}.mp4`;
          const playUrl = vgTaskFileUrl(task.task_id, name, false);
          const dlUrl = vgTaskFileUrl(task.task_id, name, true);
          return (
            <li
              key={p}
              className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
            >
              <video
                src={playUrl}
                controls
                preload="metadata"
                className="w-full bg-black"
                style={{ aspectRatio: '9 / 16', maxHeight: '50vh' }}
              />
              <div className="flex items-center justify-between gap-2 p-2">
                <p className="truncate text-xs text-[var(--cy-text-tertiary)]" title={name}>{name}</p>
                <a
                  href={dlUrl}
                  download
                  className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
                >
                  <Download className="h-3 w-3" /> 下载
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-4 py-2 text-sm text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
        >
          <RefreshCw className="h-4 w-4" /> 用相同参数再合成一次
        </button>
        <button
          type="button"
          onClick={onNewTask}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)]"
        >
          <Sparkles className="h-4 w-4" /> 开始新视频
        </button>
      </div>
    </div>
  );
};

const FailedPane: React.FC<{ task: VgTask; onRestart: () => void }> = ({ task, onRestart }) => (
  <div className="space-y-3">
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-rose-900">任务失败</p>
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-white/70 p-2 text-[10px] text-rose-800 whitespace-pre-wrap">
            {task.error || '(无错误信息)'}
          </pre>
        </div>
      </div>
    </div>
    <button
      type="button"
      onClick={onRestart}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)]"
    >
      <RefreshCw className="h-4 w-4" /> 回去检查参数后重试
    </button>
  </div>
);

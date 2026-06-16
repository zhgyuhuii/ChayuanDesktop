/**
 * 进行中任务聚合面板 — N 个 task 并发 SSE 进度条。
 *
 * 设计:
 *   - 顶层 useQuery 30s 一次拉 listTasks(state in pending/processing),提供
 *     "进行中"集合;新任务由 react-query refetch 进入
 *   - 每行独立 SSE 订阅自己的 events 通道,task 进入 terminal 状态后:
 *       complete  → 触发 onTaskCompleted,父级 invalidate 'vg.videos' query
 *       failed/canceled → 行内显示终态;~5s 后自动从列表移除
 *   - 取消按钮 → cancelTask → 后端在 step 边界响应
 *
 * 并发性:浏览器 HTTP/2 同 origin 6+ 并发,N 个 SSE 都能保持长连接。后端
 * runner workers=4(M3 升过)真正并发跑 4 个 task;其它进 queue 等。
 */

import * as React from 'react';
import { vgTaskName } from './vgTaskName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Square, Loader2, AlertTriangle, CircleCheck, RefreshCw } from 'lucide-react';
import {
  videoGeneration,
  type VgTask,
  type VgTaskState,
} from '@chayuan/api';
import { reportError } from '../../store/errorDialog';

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

function progressLabel(progress: number, stageHint?: string | null): string {
  if (stageHint && stageHint.trim()) return stageHint.trim();
  const thresholds = Object.keys(STEP_LABELS).map(Number).sort((a, b) => a - b);
  let label = STEP_LABELS[5];
  for (const t of thresholds) {
    if (progress >= t) label = STEP_LABELS[t];
  }
  return label || '处理中';
}

const ACTIVE_STATES: VgTaskState[] = ['pending', 'processing'];

export const InProgressTasksPanel: React.FC = () => {
  const qc = useQueryClient();

  // 30s poll 拉运行中任务列表(后端 list 不分 state 时支持 state= 过滤;
  // 这里两次 query 合并 — pending + processing)。失败容错,不阻塞页面。
  const pendingQ = useQuery({
    queryKey: ['vg.tasks', { state: 'pending', page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listTasks({ state: 'pending', page: 1, page_size: 50 }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const processingQ = useQuery({
    queryKey: ['vg.tasks', { state: 'processing', page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listTasks({ state: 'processing', page: 1, page_size: 50 }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  // 失败任务(含服务重启中断被 reconcile 成 failed 的)也拉进来,显示「重试」入口。
  const failedQ = useQuery({
    queryKey: ['vg.tasks', { state: 'failed', page: 1, page_size: 20 }],
    queryFn: () => videoGeneration.listTasks({ state: 'failed', page: 1, page_size: 20 }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // 合并 pending + processing + failed;按 created_at 倒序
  const tasks = React.useMemo<VgTask[]>(() => {
    const all = [
      ...(pendingQ.data?.items ?? []),
      ...(processingQ.data?.items ?? []),
      ...(failedQ.data?.items ?? []),
    ];
    // 去重(刷新瞬间可能跨 state)
    const seen = new Set<string>();
    const out: VgTask[] = [];
    for (const t of all) {
      if (!seen.has(t.task_id)) {
        seen.add(t.task_id);
        out.push(t);
      }
    }
    out.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return out;
  }, [pendingQ.data, processingQ.data, failedQ.data]);

  // 单行完成时父级回调 — invalidate 视频列表 + 重拉任务集合
  const onTaskTerminal = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['vg.videos'] });
    void qc.invalidateQueries({ queryKey: ['vg.tasks'] });
  }, [qc]);

  if (tasks.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4">
      <header className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--cy-brand-500)]" />
        <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">
          进行中 <span className="ml-1 text-xs font-normal text-[var(--cy-text-tertiary)]">
            ({tasks.length})
          </span>
        </h2>
        <span className="ml-auto text-[10px] text-[var(--cy-text-tertiary)]">
          后端 worker 池 4 并发,其余在队列排队
        </span>
      </header>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <TaskProgressRow
            key={t.task_id}
            initialTask={t}
            onTerminal={onTaskTerminal}
          />
        ))}
      </ul>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 单行
// ─────────────────────────────────────────────────────────────────────

const TaskProgressRow: React.FC<{
  initialTask: VgTask;
  onTerminal(task_id: string): void;
}> = ({ initialTask, onTerminal }) => {
  const [task, setTask] = React.useState<VgTask>(initialTask);
  const [hidden, setHidden] = React.useState(false);
  const taskId = initialTask.task_id;

  React.useEffect(() => {
    const ctl = new AbortController();
    void videoGeneration
      .subscribeTaskEvents(
        taskId,
        { onTask: (t) => setTask(t) },
        { signal: ctl.signal },
      )
      .catch((e: Error) => {
        if (!ctl.signal.aborted) {
          // SSE 失败不弹错对话框 — 用户可能开了 N 个,弹堆太烦
          // eslint-disable-next-line no-console
          console.warn('[vg.tasks.events]', taskId, e);
        }
      });
    return () => ctl.abort();
  }, [taskId]);

  // 进入终态:complete/canceled 5s 后移除;failed 保留(让用户能点重试),不自动消失。
  React.useEffect(() => {
    const s = task.state;
    if (s === 'complete' || s === 'canceled') {
      onTerminal(task.task_id);
      const t = setTimeout(() => setHidden(true), 5000);
      return () => clearTimeout(t);
    }
    if (s === 'failed') onTerminal(task.task_id);
    return undefined;
  }, [task.state, task.task_id, onTerminal]);

  if (hidden) return null;

  const onCancel = async () => {
    try {
      await videoGeneration.cancelTask(taskId);
    } catch (e) {
      reportError(e as Error, '取消任务失败');
    }
  };

  const onRetry = async () => {
    try {
      await videoGeneration.retryTask(taskId);
    } catch (e) {
      reportError(e as Error, '重试任务失败');
    }
  };

  const progress = task.progress;
  const label = progressLabel(progress, task.result?.stage_hint);
  const subject = vgTaskName(task.params, '(未命名主题)');
  const isTerminal = task.state === 'complete' || task.state === 'failed' || task.state === 'canceled';

  return (
    <li className="rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
      <div className="flex items-center gap-3">
        {/* 状态 icon */}
        <div className="shrink-0">
          {task.state === 'pending' && (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--cy-text-tertiary)]" />
          )}
          {task.state === 'processing' && (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--cy-brand-500)]" />
          )}
          {task.state === 'complete' && (
            <CircleCheck className="h-4 w-4 text-emerald-600" />
          )}
          {task.state === 'failed' && (
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          )}
          {task.state === 'canceled' && (
            <Square className="h-4 w-4 text-[var(--cy-text-tertiary)]" />
          )}
        </div>

        {/* 主体 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-[var(--cy-text-primary)]" title={subject}>
              {subject}
            </p>
            <div className="flex items-center gap-2 shrink-0 text-xs">
              <span className="text-[var(--cy-text-tertiary)]">
                {task.task_id.slice(0, 8)}…
              </span>
              {!isTerminal && (
                <button
                  type="button"
                  onClick={onCancel}
                  title="取消任务"
                  className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-[10px] text-[var(--cy-text-secondary)] hover:border-rose-300 hover:text-rose-600"
                >
                  <Square className="h-2.5 w-2.5" /> 取消
                </button>
              )}
              {(task.state === 'failed' || task.state === 'canceled') && (
                <button
                  type="button"
                  onClick={onRetry}
                  title="重试 / 继续生成"
                  className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-brand-400)] hover:text-[var(--cy-brand-600)]"
                >
                  <RefreshCw className="h-2.5 w-2.5" /> 重试
                </button>
              )}
            </div>
          </div>

          {/* 进度条 */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--cy-surface-2)]">
              <div
                className={
                  'h-full transition-all ' +
                  (task.state === 'failed' ? 'bg-rose-500'
                    : task.state === 'canceled' ? 'bg-zinc-400'
                    : task.state === 'complete' ? 'bg-emerald-500'
                    : 'bg-[var(--cy-brand-500)]')
                }
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-[var(--cy-text-tertiary)]">
              {progress}%
            </span>
          </div>

          {/* 步骤 / 错误信息 */}
          <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
            {task.state === 'failed' ? (
              <span className="text-rose-600" title={task.error || ''}>
                ⚠ 失败:{(task.error || '未知错误').slice(0, 80)}
              </span>
            ) : task.state === 'canceled' ? (
              <span>已取消</span>
            ) : task.state === 'complete' ? (
              <span className="text-emerald-700">已完成 — 下方"已生成"列表自动出现</span>
            ) : (
              <span>{label}</span>
            )}
          </p>
        </div>
      </div>
    </li>
  );
};

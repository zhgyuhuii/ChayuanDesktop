/**
 * 视频任务面板 —— 「我的视频」页的「视频任务」tab 内容。
 *
 * 列全部任务,按状态分三组:执行中(pending/processing)/ 失败(failed/canceled)/
 * 已完成(complete)。
 *   - 执行中:取消
 *   - 失败/取消:重试 + 删除
 *   - 已完成:查看视频(跳到「我的视频」tab 滚动+选中对应成片)+ 删除(保留成片)
 *   - 顶部「清理已结束」:批量删除 失败/取消/已完成 的任务记录(drop_file=false 保留成片)
 *
 * 轮询(5s)刷新;不依赖 SSE —— 任务管理视角用轮询足够,实时进度看「我的视频」首页面板。
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Square, RefreshCw, Trash2, Video as VideoIcon, AlertTriangle, CircleCheck, Eraser } from 'lucide-react';
import { videoGeneration, type VgTask, type VgTaskState } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { confirmDialog } from '../../store/confirmDialog';

type Group = 'running' | 'failed' | 'done';
const GROUP_LABEL: Record<Group, string> = { running: '执行中', failed: '失败 / 已取消', done: '已完成' };
function groupOf(s: VgTaskState): Group {
  if (s === 'pending' || s === 'processing') return 'running';
  if (s === 'failed' || s === 'canceled') return 'failed';
  return 'done';
}

export const VgTaskListPanel: React.FC<{
  /** 点「查看视频」→ 跳到「我的视频」tab 并滚动选中该 task 对应成片 */
  onViewVideo: (taskId: string) => void;
}> = ({ onViewVideo }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['vg.tasks', 'all'],
    queryFn: () => videoGeneration.listTasks({ page: 1, page_size: 100 }),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const tasks = q.data?.items ?? [];

  const grouped = React.useMemo(() => {
    const g: Record<Group, VgTask[]> = { running: [], failed: [], done: [] };
    for (const t of tasks) g[groupOf(t.state)].push(t);
    for (const k of Object.keys(g) as Group[]) g[k].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return g;
  }, [tasks]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['vg.tasks'] });
    void qc.invalidateQueries({ queryKey: ['vg.videos'] });
  };

  const cancelMut = useMutation({ mutationFn: (id: string) => videoGeneration.cancelTask(id), onSuccess: invalidate, onError: (e) => reportError(e as Error, '取消失败') });
  const retryMut = useMutation({ mutationFn: (id: string) => videoGeneration.retryTask(id), onSuccess: invalidate, onError: (e) => reportError(e as Error, '重试失败') });
  // 删任务记录但保留成片文件(drop_file=false),避免清理任务把视频也删了
  const delMut = useMutation({ mutationFn: (id: string) => videoGeneration.deleteTask(id, { drop_file: false }), onSuccess: invalidate, onError: (e) => reportError(e as Error, '删除失败') });

  const onClearEnded = async () => {
    const ended = [...grouped.failed, ...grouped.done];
    if (ended.length === 0) return;
    if (!(await confirmDialog(`清理 ${ended.length} 条已结束任务记录?(成片保留在「我的视频」)`, {}))) return;
    for (const t of ended) {
      try { await videoGeneration.deleteTask(t.task_id, { drop_file: false }); } catch (e) { reportError(e as Error); }
    }
    invalidate();
  };

  if (q.isLoading) return <p className="text-sm text-[var(--cy-text-tertiary)]">加载中…</p>;
  if (tasks.length === 0) return <p className="rounded-xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-8 text-center text-sm text-[var(--cy-text-secondary)]">暂无任务</p>;

  const stateIcon = (s: VgTaskState) => {
    if (s === 'pending' || s === 'processing') return <Loader2 className="h-4 w-4 animate-spin text-[var(--cy-brand-500)]" />;
    if (s === 'complete') return <CircleCheck className="h-4 w-4 text-emerald-600" />;
    if (s === 'failed') return <AlertTriangle className="h-4 w-4 text-rose-600" />;
    return <Square className="h-4 w-4 text-[var(--cy-text-tertiary)]" />;
  };
  const btn = 'inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)] disabled:opacity-50';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => void onClearEnded()}
          disabled={grouped.failed.length + grouped.done.length === 0}
          className={btn} title="清理失败/已完成的任务记录(保留成片)">
          <Eraser className="h-3 w-3" /> 清理已结束
        </button>
      </div>
      {(['running', 'failed', 'done'] as Group[]).filter((g) => grouped[g].length > 0).map((g) => (
        <section key={g}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--cy-text-tertiary)]">
            {GROUP_LABEL[g]} · {grouped[g].length}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {grouped[g].map((t) => (
              <li key={t.task_id} className="flex items-center gap-2 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2">
                <span className="shrink-0">{stateIcon(t.state)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--cy-text-primary)]" title={t.params?.video_subject || ''}>
                    {t.params?.video_subject || '(未命名)'}
                  </p>
                  <p className="truncate text-[10px] text-[var(--cy-text-tertiary)]">
                    {t.task_id.slice(0, 8)}…
                    {g === 'running' ? ` · ${t.progress}%` : ''}
                    {t.state === 'failed' && t.error ? ` · ⚠ ${t.error.slice(0, 50)}` : ''}
                  </p>
                </div>
                {g === 'running' && (
                  <button type="button" onClick={() => cancelMut.mutate(t.task_id)} className={btn} title="取消">
                    <Square className="h-3 w-3" /> 取消
                  </button>
                )}
                {g === 'failed' && (
                  <button type="button" onClick={() => retryMut.mutate(t.task_id)} className={btn} title="重试 / 继续">
                    <RefreshCw className="h-3 w-3" /> 重试
                  </button>
                )}
                {g === 'done' && (
                  <button type="button" onClick={() => onViewVideo(t.task_id)} className={btn} title="查看成片">
                    <VideoIcon className="h-3 w-3" /> 查看视频
                  </button>
                )}
                {g !== 'running' && (
                  <button type="button" onClick={() => delMut.mutate(t.task_id)} className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-[10px] text-rose-700 hover:border-rose-300" title="删除任务记录(保留成片)">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

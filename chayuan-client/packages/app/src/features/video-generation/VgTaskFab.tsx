/**
 * 全局「视频任务」浮标(FAB)—— 解决"图文成片任务跑起来后找不到入口"。
 *
 * 行为(用户诉求:底部任务按钮 / 点开任务页 / 完成隐藏):
 *   - 有 pending/processing 的 VG 任务时,右下角常驻一个浮标(转圈 + 数量);
 *     全部结束(无在跑任务)时整体不渲染 —— 自动隐藏。
 *   - 点击展开 popover,直接复用 <InProgressTasksPanel/>:每个任务一行
 *     SSE 实时进度(含素材下载阶段的 stage_hint)+ 取消 / 重试。
 *   - popover 内「打开我的视频页」跳到 /video-generation/library 看全量任务列表。
 *
 * 复用:计数用与 InProgressTasksPanel 相同的 react-query key,缓存共享、不额外打接口。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, X, ExternalLink } from 'lucide-react';
import { videoGeneration, type VgTask } from '@chayuan/api';
import { useTabsStore } from '../../store/tabs';
import { InProgressTasksPanel } from './InProgressTasksPanel';

export const VgTaskFab: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const [open, setOpen] = React.useState(false);

  // 与 InProgressTasksPanel 同 queryKey → 共享缓存;有在跑任务时 10s 轮询。
  const pendingQ = useQuery({
    queryKey: ['vg.tasks', { state: 'pending', page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listTasks({ state: 'pending', page: 1, page_size: 50 }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const processingQ = useQuery({
    queryKey: ['vg.tasks', { state: 'processing', page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listTasks({ state: 'processing', page: 1, page_size: 50 }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const running = React.useMemo<VgTask[]>(() => {
    const all = [...(pendingQ.data?.items ?? []), ...(processingQ.data?.items ?? [])];
    const seen = new Set<string>();
    const out: VgTask[] = [];
    for (const t of all) {
      if (!seen.has(t.task_id)) { seen.add(t.task_id); out.push(t); }
    }
    return out;
  }, [pendingQ.data, processingQ.data]);

  // 无在跑任务 → 整体隐藏(同时关掉可能残留的 popover)
  React.useEffect(() => {
    if (running.length === 0 && open) setOpen(false);
  }, [running.length, open]);

  if (running.length === 0) return null;

  // 展示最慢任务的进度(纯视觉提示)
  const minProgress = running.reduce((m, t) => Math.min(m, t.progress ?? 0), 100);

  const openLibrary = () => {
    setOpen(false);
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  };

  return (
    <>
      {/* 点击空白处关闭 */}
      {open && (
        <div
          className="fixed inset-0 z-[58]"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* popover —— 复用 InProgressTasksPanel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-[60] w-[min(92vw,380px)] max-h-[60vh] overflow-y-auto cy-hide-scrollbar rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--cy-text-primary)]">视频任务</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openLibrary}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
                title="打开我的视频页"
              >
                <ExternalLink className="h-3.5 w-3.5" /> 我的视频
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]"
                title="收起"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <InProgressTasksPanel />
        </div>
      )}

      {/* 浮标按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${running.length} 个视频任务进行中`}
        className="fixed bottom-10 right-5 z-[60] inline-flex items-center gap-2 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-4 py-2 text-xs font-medium text-[var(--cy-text-primary)] shadow-lg transition-shadow hover:border-[var(--cy-brand-400)] hover:shadow-xl"
      >
        <Loader2 className="h-4 w-4 animate-spin text-[var(--cy-brand-500)]" />
        <span>视频任务 {running.length}</span>
        <span className="tabular-nums text-[var(--cy-text-tertiary)]">{minProgress}%</span>
      </button>
    </>
  );
};

/**
 * 视频中心数据源:并行拉「图文成片」(vg.videos) 与「数字人」(dh.tasks),
 * 归一为 UnifiedVideo 并分区。仅当存在进行中的 DH 任务时才对 dh.tasks 开 3s 轮询。
 */
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, digitalHuman, type DhTaskStatus } from '@chayuan/api';
import { mergeUnifiedVideos } from './unifiedVideos';

function hasActiveDh(items: DhTaskStatus[] | undefined): boolean {
  return (items ?? []).some(
    (t) => t.state !== 'complete' && t.state !== 'failed' && t.state !== 'canceled',
  );
}

export function useUnifiedVideos() {
  const vq = useQuery({
    queryKey: ['vg.videos', { page: 1, page_size: 100 }],
    queryFn: () => videoGeneration.listVideos({ page: 1, page_size: 100 }),
    staleTime: 30_000,
  });
  const dq = useQuery({
    queryKey: ['dh.tasks'],
    queryFn: digitalHuman.listTasks,
    // 仅进行中任务存在时轮询,避免空转
    refetchInterval: (q) => (hasActiveDh(q.state.data?.items) ? 3000 : false),
  });

  const { completed, active } = mergeUnifiedVideos(vq.data?.items ?? [], dq.data ?? { items: [] });
  return {
    completed,
    active,
    isLoading: vq.isLoading || dq.isLoading,
    vgError: (vq.error as Error | null) ?? null,
    dhError: (dq.error as Error | null) ?? null,
  };
}

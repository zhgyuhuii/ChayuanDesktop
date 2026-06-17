/**
 * 视频中心数据源:汇总「图文成片」(vg.videos)。
 * 数字人已全局隐藏 → 不再并拉 dh.tasks(原 hasActiveDh 轮询逻辑已下线;
 * 恢复数字人时从 git 历史还原本文件即可)。
 */
import { useQuery } from '@tanstack/react-query';
import { videoGeneration } from '@chayuan/api';
import { mergeUnifiedVideos } from './unifiedVideos';

export function useUnifiedVideos() {
  const vq = useQuery({
    queryKey: ['vg.videos', { page: 1, page_size: 100 }],
    queryFn: () => videoGeneration.listVideos({ page: 1, page_size: 100 }),
    staleTime: 30_000,
  });

  // dh 传空 → 视频中心只剩 VG;active(数字人进行中)恒为空。
  const { completed, active } = mergeUnifiedVideos(vq.data?.items ?? [], { items: [] });
  return {
    completed,
    active,
    isLoading: vq.isLoading,
    vgError: (vq.error as Error | null) ?? null,
    dhError: null as Error | null,
  };
}

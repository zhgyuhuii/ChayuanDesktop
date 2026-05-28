/**
 * 我的视频页 — 列已生成的成品视频。
 *
 * M5.A3 阶段:列表骨架 + 缩略卡片;
 * 时间线分组 + 内嵌播放器 + 复制参数重做 留 M5.B6。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, type VgVideo } from '@chayuan/api';

export const VideoLibraryPage: React.FC = () => {
  const q = useQuery({
    queryKey: ['vg.videos', { page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listVideos({ page: 1, page_size: 50 }),
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 px-6 py-8">
      <header>
        <h1 className="text-xl font-semibold text-[var(--cy-text-primary)]">我的视频</h1>
        <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">
          已合成的成品视频清单,按创建时间倒序
        </p>
      </header>

      {q.isLoading && (
        <div className="text-sm text-[var(--cy-text-tertiary)]">加载中…</div>
      )}
      {q.isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          加载失败:{(q.error as Error).message}
        </div>
      )}

      {q.data && q.data.items.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center">
          <p className="text-sm text-[var(--cy-text-secondary)]">还没有成品</p>
          <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
            到「视频生成」走完 wizard 7 步,这里就会有内容
          </p>
        </div>
      )}

      {q.data && q.data.items.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.items.map((v: VgVideo) => (
            <li
              key={v.video_id}
              className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
            >
              <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
                {v.thumbnail_path ? '(缩略图 M5.B6)' : '(无缩略图)'}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium text-[var(--cy-text-primary)]">
                  {v.title || '未命名视频'}
                </p>
                <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
                  {v.width}×{v.height} · {v.duration_ms ? `${Math.round(v.duration_ms / 1000)}s` : '时长未知'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

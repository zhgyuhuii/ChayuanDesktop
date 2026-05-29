/**
 * 我的视频页 — 列已生成的成品视频。
 *
 * 时间线分组(今天 / 本周 / 本月 / 更早)+ 内嵌播放器 + 下载 + 删除 +
 * 复制参数重做(把 video.params_snapshot 写回 vgComposer 并跳 wizard step 7)。
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Video, Download, RefreshCw, Trash2 } from 'lucide-react';
import {
  videoGeneration,
  vgTaskFileUrl,
  type VgVideo,
  type VgVideoParams,
  VG_DEFAULT_PARAMS,
} from '@chayuan/api';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer } from './store/vgComposer';
import { InProgressTasksPanel } from './InProgressTasksPanel';
import { reportError } from '../../store/errorDialog';
import { confirmDialog } from '../../store/confirmDialog';

type Bucket = 'today' | 'this-week' | 'this-month' | 'older';
const BUCKET_LABEL: Record<Bucket, string> = {
  today: '今天',
  'this-week': '本周',
  'this-month': '本月',
  older: '更早',
};

function bucketOf(ms: number | null | undefined): Bucket {
  if (!ms) return 'older';
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  if (now - ms < dayMs) return 'today';
  if (now - ms < 7 * dayMs) return 'this-week';
  if (now - ms < 31 * dayMs) return 'this-month';
  return 'older';
}

export const VideoLibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const openTab = useTabsStore((s) => s.open);
  const patchParams = useVgComposer((s) => s.patchParams);
  const setStep = useVgComposer((s) => s.setStep);
  const setActiveTaskId = useVgComposer((s) => s.setActiveTaskId);

  const q = useQuery({
    queryKey: ['vg.videos', { page: 1, page_size: 100 }],
    queryFn: () => videoGeneration.listVideos({ page: 1, page_size: 100 }),
    staleTime: 30_000,
  });

  const items = q.data?.items ?? [];

  // 按时间分组
  const grouped = React.useMemo(() => {
    const map: Record<Bucket, VgVideo[]> = {
      today: [], 'this-week': [], 'this-month': [], older: [],
    };
    for (const v of items) {
      map[bucketOf(v.created_at)].push(v);
    }
    return map;
  }, [items]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => videoGeneration.deleteVideo(id, { drop_file: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vg.videos'] });
    },
  });

  const onCopyAndRedo = (v: VgVideo) => {
    // 复制 params_snapshot 回填 store(只取后端 schema 内已知字段,避免脏字段)
    const merged: VgVideoParams = { ...VG_DEFAULT_PARAMS, ...(v.params_snapshot as Partial<VgVideoParams>) };
    patchParams(merged);
    setActiveTaskId(null);
    setStep(7);
    openTab('/video-generation', { title: '视频生成', icon: 'video' });
    void navigate({ to: '/video-generation' as never });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto cy-hide-scrollbar px-6 py-8">
      <header>
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-[var(--cy-text-primary)]">
          <Video className="h-5 w-5" /> 我的视频
        </h1>
        <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">
          已合成的成品按时间分组,可在线播放 / 下载 / 复制参数重做
        </p>
      </header>

      {/* N7:进行中任务聚合面板 — 多 SSE 并发显示进度条,完成自动消失 */}
      <InProgressTasksPanel />

      {q.isLoading && <p className="text-sm text-[var(--cy-text-tertiary)]">加载中…</p>}
      {q.isError && (
        <p className="text-xs text-rose-700">加载失败:{(q.error as Error).message}</p>
      )}
      {items.length === 0 && q.isFetched && (
        <div className="rounded-xl border-2 border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center">
          <p className="text-sm text-[var(--cy-text-secondary)]">还没有成品</p>
          <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
            到「视频生成」走完 wizard 7 步,这里就会有内容
          </p>
        </div>
      )}

      {(['today', 'this-week', 'this-month', 'older'] as Bucket[])
        .filter((b) => grouped[b].length > 0)
        .map((bucket) => (
          <section key={bucket}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--cy-text-tertiary)]">
              {BUCKET_LABEL[bucket]} · {grouped[bucket].length}
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[bucket].map((v) => (
                <VideoCard
                  key={v.video_id}
                  v={v}
                  onCopyRedo={() => onCopyAndRedo(v)}
                  onDelete={async () => {
                    if (!(await confirmDialog(`删除「${v.title || '未命名视频'}」?磁盘文件会一并清掉。`, { danger: true }))) return;
                    try { await deleteMut.mutateAsync(v.video_id); } catch (e) { reportError(e as Error); }
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
};

const VideoCard: React.FC<{
  v: VgVideo;
  onCopyRedo: () => void;
  onDelete: () => void;
}> = ({ v, onCopyRedo, onDelete }) => {
  const name = v.path.split(/[\\/]/).pop() || `${v.video_id}.mp4`;
  const playUrl = vgTaskFileUrl(v.task_id, name, false);
  const dlUrl = vgTaskFileUrl(v.task_id, name, true);
  return (
    <li className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]">
      <video
        src={playUrl}
        controls
        preload="metadata"
        className="w-full bg-black"
        style={{ aspectRatio: v.width && v.height ? `${v.width} / ${v.height}` : '9 / 16', maxHeight: '40vh' }}
      />
      <div className="p-3">
        <p className="truncate text-sm font-medium text-[var(--cy-text-primary)]">
          {v.title || '未命名视频'}
        </p>
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
          {v.width || '?'}×{v.height || '?'}
          {v.duration_ms ? ` · ${Math.round(v.duration_ms / 1000)}s` : ''}
          {v.created_at ? ` · ${new Date(v.created_at).toLocaleString()}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <a
            href={dlUrl}
            download
            className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
          >
            <Download className="h-3 w-3" /> 下载
          </a>
          <button
            type="button"
            onClick={onCopyRedo}
            className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
          >
            <RefreshCw className="h-3 w-3" /> 用参数重做
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700 hover:border-rose-300"
          >
            <Trash2 className="h-3 w-3" /> 删除
          </button>
        </div>
      </div>
    </li>
  );
};

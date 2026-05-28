/**
 * 素材库页 — 用户上传 + 内置 bundled 素材合并视图。
 *
 * M5.A3 阶段:列表骨架 + 上传按钮 + 删除入口;
 * grid/list 双视图 + 标签筛选 + 拖入 wizard 留 M5.B6。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { videoGeneration, type VgMaterial } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';

export const MaterialLibraryPage: React.FC = () => {
  const q = useQuery({
    queryKey: ['vg.materials', { page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listMaterials({ page: 1, page_size: 50 }),
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 px-6 py-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--cy-text-primary)]">素材库</h1>
          <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">
            我上传的素材 + 出厂内置 — 视频生成 wizard step 5 共用这套数据源
          </p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-xs text-[var(--cy-text-tertiary)] opacity-60"
          title="上传 / 拖拽 / 双视图 留 M5.B6 实现"
        >
          <Upload className="h-3.5 w-3.5" />
          上传素材 (M5.B6)
        </button>
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
          <p className="text-sm text-[var(--cy-text-secondary)]">还没有素材</p>
          <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
            wizard step 5 上传 / 在线搜索能将素材沉淀到这里
          </p>
        </div>
      )}

      {q.data && q.data.items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {q.data.items.map((m: VgMaterial) => (
            <li
              key={m.material_id}
              className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
            >
              <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
                {m.thumbnail_path ? '(缩略图 M5.B6)' : '(无缩略图)'}
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium text-[var(--cy-text-primary)]">{m.name}</p>
                <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
                  {m.source} · {(m.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

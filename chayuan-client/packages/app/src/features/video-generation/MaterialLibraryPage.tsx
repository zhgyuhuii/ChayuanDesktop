/**
 * 素材库页 — 用户上传 + 内置 bundled 素材合并视图。
 *
 * 功能:
 *   · grid / list 双视图切换
 *   · 来源 chip 筛选(all / upload / bundled / pexels / pixabay)
 *   · 上传(点击 / 拖拽,多文件顺序上传 + 进度展示)
 *   · 多选 → 批量删除
 *   · 选中项右上角 CheckCircle2,跟 wizard step 5 同样视觉
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Library, LayoutGrid, LayoutList, Loader2, Trash2, Upload, X,
} from 'lucide-react';
import { videoGeneration, type VgMaterial } from '@chayuan/api';
import { reportError, notifySuccess } from '../../store/errorDialog';

type View = 'grid' | 'list';
type Source = 'all' | 'upload' | 'bundled' | 'pexels' | 'pixabay';

const SOURCE_LABEL: Record<Source, string> = {
  all: '全部',
  upload: '我上传的',
  bundled: '内置出厂',
  pexels: 'Pexels',
  pixabay: 'Pixabay',
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const MaterialLibraryPage: React.FC = () => {
  const qc = useQueryClient();
  const [view, setView] = React.useState<View>('grid');
  const [source, setSource] = React.useState<Source>('all');
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

  const q = useQuery({
    queryKey: ['vg.materials', { source, page: 1, page_size: 100 }],
    queryFn: () => videoGeneration.listMaterials({
      source: source === 'all' ? undefined : source,
      page: 1, page_size: 100,
    }),
    staleTime: 30_000,
  });

  const items = q.data?.items ?? [];

  const uploadInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadMut = useMutation({
    mutationFn: (file: File) => videoGeneration.uploadMaterial({ file }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vg.materials'] });
    },
    onError: (e) => reportError(e as Error, '上传失败'),
  });

  const onPick = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      await uploadMut.mutateAsync(f);
    }
    notifySuccess(`已上传 ${files.length} 个素材`);
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => videoGeneration.deleteMaterial(id, { drop_file: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vg.materials'] });
    },
  });

  const onDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确认删除 ${selectedIds.size} 个素材?磁盘文件会一并清掉。`)) return;
    for (const id of selectedIds) {
      try { await deleteMut.mutateAsync(id); } catch (e) { reportError(e as Error); }
    }
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelected = () => setSelectedIds(new Set());

  return (
    <div
      className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto cy-hide-scrollbar px-6 py-8"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void onPick(e.dataTransfer.files);
      }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-[var(--cy-text-primary)]">
            <Library className="h-5 w-5" /> 素材库
          </h1>
          <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">
            我上传 + 出厂内置 + 在线下载缓存 — 视频生成 wizard step 5 共用这套数据源
          </p>
        </div>
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)]"
        >
          <Upload className="h-3.5 w-3.5" /> 上传素材
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="video/*,image/*"
          multiple
          className="hidden"
          onChange={(e) => void onPick(e.target.files)}
        />
      </header>

      {/* 工具栏:来源 chip + 视图切换 + 批量操作 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cy-border-subtle)] pb-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSource(s)}
              className={
                'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                (source === s
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
              }
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-[var(--cy-text-tertiary)]">已选 {selectedIds.size} 个</span>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:border-rose-300"
              >
                <Trash2 className="h-3 w-3" /> 删除
              </button>
              <button
                type="button"
                onClick={clearSelected}
                className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)]"
              >
                <X className="h-3 w-3" /> 清除选择
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setView('grid')}
            title="网格视图"
            className={
              'inline-flex h-7 w-7 items-center justify-center rounded border ' +
              (view === 'grid'
                ? 'border-[var(--cy-brand-500)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-tertiary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            title="列表视图"
            className={
              'inline-flex h-7 w-7 items-center justify-center rounded border ' +
              (view === 'list'
                ? 'border-[var(--cy-brand-500)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-tertiary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            <LayoutList className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 上传中提示 */}
      {uploadMut.isPending && (
        <p className="inline-flex items-center gap-1.5 text-xs text-[var(--cy-text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 上传中…
        </p>
      )}

      {/* 列表 */}
      {q.isLoading && <p className="text-sm text-[var(--cy-text-tertiary)]">加载中…</p>}
      {q.isError && (
        <p className="text-xs text-rose-700">加载失败:{(q.error as Error).message}</p>
      )}
      {items.length === 0 && q.isFetched && (
        <div className="rounded-xl border-2 border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center">
          <p className="text-sm text-[var(--cy-text-secondary)]">
            {source === 'all' ? '素材库为空' : `没有 ${SOURCE_LABEL[source]} 类型的素材`}
          </p>
          <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
            点上方「上传素材」或直接拖拽视频文件到本页
          </p>
        </div>
      )}

      {view === 'grid' && items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((m) => (
            <MaterialGridCard
              key={m.material_id}
              m={m}
              selected={selectedIds.has(m.material_id)}
              onToggle={() => toggleSelect(m.material_id)}
            />
          ))}
        </ul>
      )}

      {view === 'list' && items.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--cy-border-subtle)] text-left text-[var(--cy-text-tertiary)]">
              <th className="p-2 w-10"></th>
              <th className="p-2">名称</th>
              <th className="p-2">来源</th>
              <th className="p-2">大小</th>
              <th className="p-2">时长</th>
              <th className="p-2">使用</th>
              <th className="p-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.material_id} className="border-b border-[var(--cy-border-subtle)] hover:bg-[var(--cy-surface-1)]">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.material_id)}
                    onChange={() => toggleSelect(m.material_id)}
                  />
                </td>
                <td className="p-2 font-medium text-[var(--cy-text-primary)]">{m.name}</td>
                <td className="p-2 text-[var(--cy-text-tertiary)]">{m.source}</td>
                <td className="p-2 text-[var(--cy-text-tertiary)]">{fmtSize(m.size)}</td>
                <td className="p-2 text-[var(--cy-text-tertiary)]">
                  {m.duration_ms ? `${Math.round(m.duration_ms / 1000)}s` : '-'}
                </td>
                <td className="p-2 text-[var(--cy-text-tertiary)]">{m.used_count}</td>
                <td className="p-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`删除 ${m.name}?`)) return;
                      try {
                        await deleteMut.mutateAsync(m.material_id);
                      } catch (e) { reportError(e as Error); }
                    }}
                    className="text-rose-500 hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const MaterialGridCard: React.FC<{
  m: VgMaterial;
  selected: boolean;
  onToggle: () => void;
}> = ({ m, selected, onToggle }) => (
  <li>
    <button
      type="button"
      onClick={onToggle}
      className={
        'group relative w-full overflow-hidden rounded-xl border text-left transition-colors ' +
        (selected
          ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
          : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')
      }
    >
      <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
        {m.thumbnail_path ? '(缩略图)' : `${m.mime || 'video'}`}
      </div>
      <div className="p-2.5">
        <p className="truncate text-xs font-medium text-[var(--cy-text-primary)]">{m.name}</p>
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
          {m.source} · {fmtSize(m.size)}
          {m.duration_ms ? ` · ${Math.round(m.duration_ms / 1000)}s` : ''}
        </p>
      </div>
      {selected && (
        <span className="absolute right-2 top-2 inline-block h-5 w-5 rounded-full border-2 border-white bg-[var(--cy-brand-500)] shadow"></span>
      )}
    </button>
  </li>
);

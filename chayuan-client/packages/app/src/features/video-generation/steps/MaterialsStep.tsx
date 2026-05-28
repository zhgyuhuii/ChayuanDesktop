/**
 * Step 5 · 素材(三 tab:我的素材 / 在线搜索 / 上传)。
 *
 * 选中的素材写入 vgComposer.params.video_materials(VgMaterialInfo[]),
 * 顺序就是合成时拼接顺序。当前用 click toggle 选/取消;拖拽排序留后续
 * 体验优化阶段做。
 *
 * 在线搜索默认禁用 — 后端 search 返 412 时(API Key 未配)友好提示,
 * 用户先配 Pexels/Pixabay API Key 才能用;离线场景全靠"我的素材库" +
 * vendor bundled clips。
 */
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Library, Search, Upload, X, CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react';
import {
  videoGeneration,
  type VgMaterial,
  type VgMaterialInfo,
} from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { reportError } from '../../../store/errorDialog';

type Tab = 'mine' | 'online' | 'upload';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'mine', label: '我的素材', icon: Library },
  { id: 'online', label: '在线搜索', icon: Search },
  { id: 'upload', label: '上传新素材', icon: Upload },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const MaterialsStep: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>('mine');
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const selected = params.video_materials ?? [];
  const qc = useQueryClient();

  // 切到 local 模式自动:用户进了素材步骤,确保 video_source=local 让后端走本地路径
  React.useEffect(() => {
    if (tab === 'online' && params.video_source === 'local') {
      patchParams({ video_source: 'pexels' });
    } else if (tab !== 'online' && params.video_source !== 'local') {
      patchParams({ video_source: 'local' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const toggleSelect = React.useCallback((item: VgMaterialInfo) => {
    const exists = selected.findIndex((m) => m.url === item.url);
    if (exists >= 0) {
      patchParams({ video_materials: selected.filter((_, i) => i !== exists) });
    } else {
      patchParams({ video_materials: [...selected, item] });
    }
  }, [selected, patchParams]);

  const clearSelected = React.useCallback(() => {
    patchParams({ video_materials: [] });
  }, [patchParams]);

  return (
    <div className="space-y-4">
      {/* tab chip */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ' +
                (tab === t.id
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
              }
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
        {selected.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-[var(--cy-text-tertiary)]">
            已选 {selected.length} 段
            <button
              type="button"
              onClick={clearSelected}
              className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-[10px] hover:border-[var(--cy-border-strong)]"
            >
              <X className="h-3 w-3" /> 清空
            </button>
          </div>
        )}
      </div>

      {tab === 'mine' && (
        <MineTab selected={selected} onToggle={toggleSelect} qc={qc} />
      )}
      {tab === 'online' && (
        <OnlineTab selected={selected} onToggle={toggleSelect} aspect={params.video_aspect} />
      )}
      {tab === 'upload' && <UploadTab qc={qc} />}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 我的素材
// ─────────────────────────────────────────────────────────────────────

const MineTab: React.FC<{
  selected: VgMaterialInfo[];
  onToggle: (item: VgMaterialInfo) => void;
  qc: ReturnType<typeof useQueryClient>;
}> = ({ selected, onToggle }) => {
  const q = useQuery({
    queryKey: ['vg.materials', { page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listMaterials({ page: 1, page_size: 50 }),
    staleTime: 30_000,
  });

  if (q.isLoading) return <div className="text-xs text-[var(--cy-text-tertiary)]">加载中…</div>;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        加载失败:{(q.error as Error).message}
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-8 text-center text-sm text-[var(--cy-text-secondary)]">
        素材库为空 — 切到「上传新素材」或「在线搜索」获取素材
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((m: VgMaterial) => {
        const url = m.path; // 后端走本地路径,合成时直接 fs.read
        const item: VgMaterialInfo = { provider: m.source, url, duration: Math.round(m.duration_ms / 1000) };
        const chosen = selected.some((s) => s.url === url);
        return (
          <li key={m.material_id}>
            <button
              type="button"
              onClick={() => onToggle(item)}
              className={
                'group relative w-full overflow-hidden rounded-xl border text-left transition-colors ' +
                (chosen
                  ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                  : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')
              }
            >
              <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
                {m.thumbnail_path ? '(缩略图)' : '(无缩略图)'}
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium text-[var(--cy-text-primary)]">{m.name}</p>
                <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
                  {m.source} · {fmtSize(m.size)}
                </p>
              </div>
              {chosen && (
                <span className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white shadow">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 在线搜索
// ─────────────────────────────────────────────────────────────────────

const OnlineTab: React.FC<{
  selected: VgMaterialInfo[];
  onToggle: (item: VgMaterialInfo) => void;
  aspect: '16:9' | '9:16' | '1:1';
}> = ({ selected, onToggle, aspect }) => {
  const [source, setSource] = React.useState<'pexels' | 'pixabay'>('pexels');
  const [keyword, setKeyword] = React.useState('');
  const [results, setResults] = React.useState<VgMaterialInfo[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);

  const onSearch = React.useCallback(async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const r = await videoGeneration.searchMaterials({
        q: keyword, source, aspect, minimum_duration: 5,
      });
      setResults(r.items);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.message.includes('412') || err.message.includes('API') || /key/i.test(err.message)) {
        setError(`${source.toUpperCase()} API Key 未配置 — 请到「设置 → 外部服务」配 ${source}_api_keys`);
      } else {
        setError(err.message || '搜索失败');
      }
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [keyword, source, aspect]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(['pexels', 'pixabay'] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSource(s)}
              className={
                'rounded-md border px-2 py-1 text-xs ' +
                (source === s
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')
              }
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          placeholder="英文关键词 — e.g. spring flower / blue sky"
          className="min-w-[14rem] flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
        />
        <button
          type="button"
          onClick={onSearch}
          disabled={searching || !keyword.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          搜索
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {results.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((item, i) => {
            const chosen = selected.some((s) => s.url === item.url);
            return (
              <li key={`${item.url}-${i}`}>
                <button
                  type="button"
                  onClick={() => onToggle(item)}
                  className={
                    'group relative w-full overflow-hidden rounded-xl border text-left transition-colors ' +
                    (chosen
                      ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                      : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')
                  }
                >
                  <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
                    {item.provider} · {item.duration}s
                  </div>
                  <p className="truncate p-2 text-[10px] text-[var(--cy-text-tertiary)]">{item.url}</p>
                  {chosen && (
                    <span className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white shadow">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 上传新素材
// ─────────────────────────────────────────────────────────────────────

const UploadTab: React.FC<{
  qc: ReturnType<typeof useQueryClient>;
}> = ({ qc }) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const mut = useMutation({
    mutationFn: (file: File) => videoGeneration.uploadMaterial({ file }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vg.materials'] });
    },
    onError: (e) => reportError(e as Error, '素材上传失败'),
  });

  const onPick = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      await mut.mutateAsync(f);
    }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void onPick(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className="cursor-pointer rounded-2xl border-2 border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center transition-colors hover:border-[var(--cy-brand-500)]"
    >
      <Upload className="mx-auto h-10 w-10 text-[var(--cy-text-tertiary)]" />
      <p className="mt-3 text-sm font-medium text-[var(--cy-text-primary)]">
        点击选择 / 拖拽视频文件
      </p>
      <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
        支持 mp4 / mov / mkv / webm + jpg / png(图像作单帧静态片段)
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => void onPick(e.target.files)}
      />
      {mut.isPending && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--cy-text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 上传中…
        </p>
      )}
    </div>
  );
};

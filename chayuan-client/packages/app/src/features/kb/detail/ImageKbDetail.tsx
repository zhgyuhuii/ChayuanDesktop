/**
 * 图像型 KB 详情。
 *
 * 设计:
 *   - 顶部 toolbar:文字搜索(本地按 caption 过滤)+ 以图搜图按钮 + 上传 + 删除
 *   - 网格 4-6 列(响应式),hover 显示 caption + 命中时显示 score badge
 *   - 点击图 → lightbox 大图(简易实现:全屏黑底 + 单图 + ESC/点击关闭)
 *   - owner 可上传 / 删除选中
 *   - 以图搜图:上传一张参考图 → 调 /search_by_image → 命中按 score 降序前置 + 高亮边框
 */

import * as React from 'react';
import { Download, Eye, ImageIcon, ImagePlus, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Button, cn } from '@chayuan/ui';
import { getAccessToken, getClientConfig, imageSource, type ImageItem, type ImageSearchHit, type KuImageDetail } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import type { DetailPanelProps } from './types';

/** 把 ku_id='src:42' 解出 sourceId=42 */
function srcIdFromKuId(kuId: string): number | null {
  if (!kuId.startsWith('src:')) return null;
  const n = Number(kuId.slice(4));
  return Number.isFinite(n) ? n : null;
}

/** 给 image url 拼上 baseURL + token query(后端 image 端点接受 query token) */
async function absImageUrl(rel: string | undefined): Promise<string> {
  if (!rel) return '';
  if (/^https?:/i.test(rel)) return rel;
  const cfg = getClientConfig();
  const base = (cfg.baseURL || '').replace(/\/+$/, '');
  const tok = await getAccessToken();
  const sep = rel.includes('?') ? '&' : '?';
  return `${base}${rel}${tok ? `${sep}token=${encodeURIComponent(tok)}` : ''}`;
}

/** 从 hit.meta 抽 image_id;后端 image connector 会把 image_id 放在 citation.meta.image_id 或 meta.image_id */
function extractImageId(hit: ImageSearchHit): string | null {
  const meta = (hit.citation?.meta || {}) as Record<string, unknown>;
  const id = meta.image_id ?? meta.id ?? meta.filename;
  if (typeof id === 'string' && id) return id;
  return null;
}

export const ImageKbDetail: React.FC<DetailPanelProps<KuImageDetail>> = ({
  detail,
  mine,
  onMutate,
}) => {
  const sourceId = React.useMemo(() => srcIdFromKuId(detail.ku_id), [detail.ku_id]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<ImageItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  // score map by image_id;非空时表示进入"以图搜图"结果模式
  const [scoreMap, setScoreMap] = React.useState<Map<string, number> | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [queryThumbUrl, setQueryThumbUrl] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const items = detail.items ?? [];

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 文字 + 以图搜图 双过滤;以图搜图模式下按 score 降序
  const displayItems = React.useMemo(() => {
    let arr: ImageItem[] = items;
    if (keyword.trim()) {
      const q = keyword.toLowerCase();
      arr = arr.filter(
        (it) =>
          it.id.toLowerCase().includes(q) ||
          (it.caption ?? '').toLowerCase().includes(q),
      );
    }
    if (scoreMap && scoreMap.size > 0) {
      // 命中前置,未命中按原顺序拼后面
      const matched: ImageItem[] = [];
      const rest: ImageItem[] = [];
      for (const it of arr) {
        if (scoreMap.has(it.id)) matched.push(it);
        else rest.push(it);
      }
      matched.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
      arr = [...matched, ...rest];
    }
    return arr;
  }, [items, keyword, scoreMap]);

  const onSearchByImage = async () => {
    if (sourceId == null) return;
    try {
      // 走 platform.fs.pickFiles 拿 File(只取 1 张)
      const picked = await getPlatform().fs.pickFiles({
        multiple: false,
        accept: ['image/*'],
      });
      if (!picked.length) return;
      const file = picked[0] as unknown as File;
      // 给查询图生成本地 thumb 显示
      try {
        const url = URL.createObjectURL(file);
        setQueryThumbUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch { /* ignore */ }

      setSearching(true);
      const hits = await imageSource.searchByImage(sourceId, file, 12);
      const map = new Map<string, number>();
      for (const h of hits) {
        const id = extractImageId(h);
        if (id) map.set(id, h.score ?? 0);
      }
      setScoreMap(map);
      if (map.size === 0) {
        notifySuccess('以图搜图:未找到相似图片');
      } else {
        notifySuccess(`以图搜图:命中 ${map.size} 张`);
      }
    } catch (e) {
      reportError(e, '以图搜图失败');
    } finally {
      setSearching(false);
    }
  };

  const onClearImageSearch = () => {
    setScoreMap(null);
    if (queryThumbUrl) {
      URL.revokeObjectURL(queryThumbUrl);
      setQueryThumbUrl(null);
    }
  };

  // 卸载时回收 objectURL
  React.useEffect(() => {
    return () => {
      if (queryThumbUrl) URL.revokeObjectURL(queryThumbUrl);
    };
  }, [queryThumbUrl]);

  const onUpload = async () => {
    if (!mine || sourceId == null) return;
    try {
      const picked = await getPlatform().fs.pickFiles({
        multiple: true,
        accept: ['image/*'],
      });
      if (!picked.length) return;
      setBusy(true);
      const r = await imageSource.upload(sourceId, picked);
      if (r.errors.length === 0) {
        notifySuccess(`已上传 ${r.added.length} 张图片`);
      } else {
        notifySuccess(`上传 ${r.added.length} 张,失败 ${r.errors.length} 张`);
      }
      onMutate();
    } catch (e) {
      reportError(e, '上传图像失败');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!mine || selected.size === 0 || sourceId == null) return;
    if (!confirm(`删除选中的 ${selected.size} 张图片?该操作不可恢复`)) return;
    setBusy(true);
    try {
      // 串行删,避免并发冲击 store._meta;失败的继续
      let okCount = 0;
      for (const id of selected) {
        const ok = await imageSource.remove(sourceId, id).catch(() => false);
        if (ok) okCount += 1;
      }
      notifySuccess(`已删除 ${okCount} 张${okCount < selected.size ? `(${selected.size - okCount} 失败)` : ''}`);
      setSelected(new Set());
      onMutate();
    } catch (e) {
      reportError(e, '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-4 py-2">
        <span className="text-xs text-[var(--cy-text-tertiary)]">
          {scoreMap ? `${displayItems.length} / ${items.length}` : `${items.length}`} 张图片
          {selected.size > 0 && <span className="ml-2 text-[var(--cy-text-secondary)]">已选 {selected.size}</span>}
        </span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cy-text-tertiary)]" />
            <input
              ref={searchInputRef}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索 caption / id"
              className="h-8 w-44 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] pl-7 pr-3 text-xs focus-visible:outline-none focus-visible:border-[var(--cy-brand-400)]"
            />
          </div>
          <Button
            size="sm"
            variant={scoreMap ? 'default' : 'outline'}
            onClick={onSearchByImage}
            disabled={searching || sourceId == null}
            className="h-8 text-xs"
            title="上传一张参考图,按相似度反查本库"
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            {searching ? '搜索中…' : '以图搜图'}
          </Button>
          <Button size="icon" variant="ghost" onClick={onMutate} aria-label="刷新" className="h-8 w-8">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {mine && selected.size > 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={onDelete} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </Button>
          )}
          {mine && (
            <Button size="sm" onClick={onUpload} className="h-8 text-xs" disabled={busy}>
              <ImagePlus className="h-3.5 w-3.5" /> 上传
            </Button>
          )}
        </div>
      </header>

      {/* 以图搜图结果条:展示查询缩略图 + 命中数 + 清除按钮 */}
      {scoreMap && (
        <div className="flex items-center gap-3 border-b border-[var(--cy-border-subtle)] bg-gradient-to-r from-pink-50 to-rose-50 px-4 py-2">
          {queryThumbUrl && (
            <img
              src={queryThumbUrl}
              alt="查询图"
              className="h-10 w-10 rounded-md border border-pink-200 object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-rose-800">以图搜图结果</p>
            <p className="text-[10px] text-rose-700/80">
              命中 {scoreMap.size} 张相似图片,按相似度排序
            </p>
          </div>
          <button
            type="button"
            onClick={onClearImageSearch}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-rose-200 bg-white px-2.5 text-[11px] text-rose-700 hover:bg-rose-100"
          >
            <X className="h-3 w-3" /> 退出搜索
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--cy-text-tertiary)]">
            还没有图片
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--cy-text-tertiary)]">
            没有匹配的图片
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {displayItems.map((img) => (
              <ImageCard
                key={img.id}
                img={img}
                score={scoreMap?.get(img.id)}
                checked={selected.has(img.id)}
                showCheckbox={mine}
                onToggle={() => toggle(img.id)}
                onPreview={() => setPreview(img)}
              />
            ))}
          </div>
        )}
      </div>

      {preview && <Lightbox img={preview} onClose={() => setPreview(null)} />}
    </div>
  );
};

const ImageCard: React.FC<{
  img: ImageItem;
  score?: number;
  checked: boolean;
  showCheckbox: boolean;
  onToggle(): void;
  onPreview(): void;
}> = ({ img, score, checked, showCheckbox, onToggle, onPreview }) => {
  const [src, setSrc] = React.useState<string>('');
  React.useEffect(() => {
    let live = true;
    void absImageUrl(img.thumb_url || img.url).then((u) => {
      if (live) setSrc(u);
    });
    return () => { live = false; };
  }, [img.thumb_url, img.url]);
  const isHit = score != null;
  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border bg-[var(--cy-surface-1)] transition-all',
        isHit
          ? 'border-rose-300 shadow-[0_0_0_2px_rgba(244,63,94,0.25)]'
          : 'border-[var(--cy-border-subtle)]',
      )}
    >
      {src ? (
        <img
          src={src}
          alt={img.caption || img.id}
          className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
          onClick={onPreview}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
          加载中…
        </div>
      )}
      {showCheckbox && (
        <label className="absolute left-1.5 top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-white/85 backdrop-blur opacity-0 transition-opacity group-hover:opacity-100 has-[:checked]:opacity-100">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-3.5 w-3.5 accent-[var(--cy-brand-500)]"
          />
        </label>
      )}
      {/* 命中分数 badge */}
      {isHit && (
        <span className="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm backdrop-blur">
          <span>{(score * 100).toFixed(0)}</span>
          <span className="opacity-80">分</span>
        </span>
      )}
      {img.caption && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100">
          {img.caption}
        </div>
      )}
      <button
        type="button"
        onClick={onPreview}
        aria-label="查看大图"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/60 group-hover:opacity-100"
      >
        <Eye className="h-3 w-3" />
      </button>
    </div>
  );
};

const Lightbox: React.FC<{ img: ImageItem; onClose(): void }> = ({ img, onClose }) => {
  const [src, setSrc] = React.useState<string>('');
  React.useEffect(() => {
    let live = true;
    void absImageUrl(img.url || img.thumb_url).then((u) => {
      if (live) setSrc(u);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, img.url, img.thumb_url]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-8"
      onClick={onClose}
    >
      <img
        src={src}
        alt={img.caption || img.id}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {src && (
        <a
          href={src}
          download={img.id}
          className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs text-white backdrop-blur hover:bg-white/20"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" /> 下载原图
        </a>
      )}
    </div>
  );
};

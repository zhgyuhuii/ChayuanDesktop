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
  Library, Search, Upload, X, CheckCircle2, Loader2, AlertCircle, Trash2, Eye, Link2, Play, Sparkles, KeyRound,
} from 'lucide-react';
import {
  videoGeneration,
  vgMaterialFileUrl,
  type VgMaterial,
  type VgMaterialInfo,
} from '@chayuan/api';
import { AiVideoGenerator } from '../../ai-video/AiVideoGenerator';
import { ingestAiVideo } from '../../ai-video/ingestAiVideo';
import { useVgComposer } from '../store/vgComposer';
import { reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';
import { VG_MATERIAL_DND_MIME, type DraggedMaterial } from '../timeline/timelineEdit';
import { OnlineSourceChips } from '../sections/OnlineSourceChips';

/** 把素材拖拽 payload 写进 dataTransfer(时间轴视频轨 drop 区读)。 */
function setDragData(e: React.DragEvent, m: DraggedMaterial) {
  e.dataTransfer.setData(VG_MATERIAL_DND_MIME, JSON.stringify(m));
  e.dataTransfer.effectAllowed = 'copy';
}

/** 素材卡左上角小角标:图片=预览眼睛,视频/音频=播放。点击弹预览窗。 */
const PlayBadge: React.FC<{ onClick: () => void; image?: boolean }> = ({ onClick, image }) => (
  <button type="button" title="预览"
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="absolute left-1.5 top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/80">
    {image ? <Eye className="h-3 w-3" /> : <Play className="h-3 w-3" />}
  </button>
);

type Tab = 'mine' | 'online' | 'link' | 'upload' | 'ai';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'mine', label: '我的素材', icon: Library },
  { id: 'online', label: '在线搜索', icon: Search },
  { id: 'link', label: '从链接', icon: Link2 },
  { id: 'upload', label: '上传新素材', icon: Upload },
  { id: 'ai', label: 'AI 生成', icon: Sparkles },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const MaterialsStep: React.FC<{ view?: 'card' | 'list' }> = ({ view = 'card' }) => {
  const [tab, setTab] = React.useState<Tab>('mine');
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const selected = params.video_materials ?? [];
  const qc = useQueryClient();

  // 切到 local 模式自动:用户进了素材步骤,确保 video_source=local 让后端走本地路径
  React.useEffect(() => {
    const onlineLike = tab === 'online' || tab === 'link';
    if (onlineLike && params.video_source === 'local') {
      patchParams({ video_source: 'pexels' });
    } else if (!onlineLike && params.video_source !== 'local') {
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
        <MineTab selected={selected} onToggle={toggleSelect} qc={qc} view={view} />
      )}
      {tab === 'online' && (
        <OnlineTab selected={selected} onToggle={toggleSelect} aspect={params.video_aspect} qc={qc} view={view} />
      )}
      {tab === 'link' && <LinkTab qc={qc} />}
      {tab === 'upload' && <UploadTab qc={qc} />}
      {tab === 'ai' && <AiGenTab qc={qc} />}
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
  view?: 'card' | 'list';
}> = ({ selected, onToggle, qc, view = 'card' }) => {
  const [preview, setPreview] = React.useState<VgMaterial | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; m: VgMaterial } | null>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    // 延迟注册,避免本次右键事件立刻关掉菜单
    const t = setTimeout(() => { window.addEventListener('click', close); window.addEventListener('keydown', onKey); }, 0);
    return () => { clearTimeout(t); window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [menu]);
  const q = useQuery({
    queryKey: ['vg.materials', { page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listMaterials({ page: 1, page_size: 50 }),
    staleTime: 30_000,
  });
  const delMut = useMutation({
    mutationFn: (id: string) => videoGeneration.deleteMaterial(id, { drop_file: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vg.materials'] }); },
    onError: (e) => reportError(e as Error, '删除素材失败'),
  });
  const [delSel, setDelSel] = React.useState<Set<string>>(new Set());
  const toggleDel = (id: string) => setDelSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const batchDelete = async () => {
    const ids = [...delSel];
    if (!ids.length) return;
    if (!(await confirmDialog(`删除选中的 ${ids.length} 个素材?磁盘文件会一并清掉。`, { danger: true }))) return;
    for (const id of ids) { try { await videoGeneration.deleteMaterial(id, { drop_file: true }); } catch (e) { reportError(e as Error, '删除素材失败'); } }
    setDelSel(new Set());
    void qc.invalidateQueries({ queryKey: ['vg.materials'] });
  };

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
        素材库为空 — 切到「上传新素材」/「在线搜索」/「从链接」获取素材
      </div>
    );
  }
  const isImg = (m: VgMaterial) => (m.mime || '').startsWith('image');
  const isAudio = (m: VgMaterial) => (m.mime || '').startsWith('audio');
  const fmtFmt = (m: VgMaterial) => (m.mime || '').split('/').pop() || (isImg(m) ? 'image' : isAudio(m) ? 'audio' : 'video');
  const thumb = (m: VgMaterial, fileUrl: string, small = false) => (
    isImg(m) ? <img src={fileUrl} alt={m.name} draggable={false} className="h-full w-full object-cover" loading="lazy" />
    : isAudio(m) ? <span className={small ? 'text-base' : 'text-2xl'}>🎵</span>
    : <video src={fileUrl} preload="metadata" muted draggable={false} className="h-full w-full object-cover" />
  );
  return (
    <>
      {delSel.size > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
          已勾选 {delSel.size} 个
          <button type="button" onClick={() => void batchDelete()}
            className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-white hover:bg-rose-700"><Trash2 className="h-3 w-3" /> 删除选中</button>
          <button type="button" onClick={() => setDelSel(new Set())} className="ml-auto text-rose-500 hover:underline">取消</button>
        </div>
      )}
      <ul className={view === 'list' ? 'flex flex-col gap-1' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}>
        {items.map((m: VgMaterial) => {
          const url = m.path;
          const item: VgMaterialInfo = { provider: m.source, url, duration: Math.round(m.duration_ms / 1000), material_id: m.material_id, kind: isImg(m) ? 'image' : 'video' };
          const chosen = selected.some((s) => s.url === url);
          const fileUrl = vgMaterialFileUrl(m.material_id);
          const dragProps = {
            draggable: true,
            onDragStart: (e: React.DragEvent) => setDragData(e, {
              materialId: m.material_id,
              kind: (isImg(m) ? 'image' : isAudio(m) ? 'audio' : 'video') as 'video' | 'image' | 'audio',
              durationMs: m.duration_ms || undefined,
            }),
          };
          if (view === 'list') {
            return (
              <li key={m.material_id} {...dragProps}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}
                className={'group flex items-center gap-2 rounded-lg border p-1 text-left transition-colors ' +
                  (chosen ? 'border-[var(--cy-brand-500)]' : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')}>
                <input type="checkbox" title="勾选以批量删除" checked={delSel.has(m.material_id)}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggleDel(m.material_id)}
                  className="ml-1 h-4 w-4 shrink-0 cursor-pointer accent-rose-600" />
                <button type="button" onClick={() => onToggle(item)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--cy-surface-2)]">{thumb(m, fileUrl, true)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-[var(--cy-text-primary)]">{m.name}</span>
                    <span className="block text-[10px] text-[var(--cy-text-tertiary)]">{Math.round((m.duration_ms || 0) / 1000)}s · {fmtFmt(m)} · {fmtSize(m.size)}</span>
                  </span>
                </button>
              </li>
            );
          }
          return (
            <li key={m.material_id} {...dragProps}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, m }); }}
              className={
                'group relative overflow-hidden rounded-xl border transition-colors ' +
                (chosen ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                        : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')
              }
            >
              <PlayBadge image={isImg(m)} onClick={() => setPreview(m)} />
              <input type="checkbox" title="勾选以批量删除" checked={delSel.has(m.material_id)}
                onClick={(e) => e.stopPropagation()} onChange={() => toggleDel(m.material_id)}
                className="absolute right-1.5 bottom-1.5 z-10 h-4 w-4 cursor-pointer accent-rose-600" />
              <button type="button" onClick={() => onToggle(item)} className="block w-full text-left">
                <div className="relative aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center overflow-hidden">
                  {thumb(m, fileUrl)}
                  {/* 卡片默认不显名,悬停才浮出 */}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">{m.name}</span>
                </div>
              </button>
              {chosen && (
                <span className="pointer-events-none absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white shadow">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {menu && (
        <div className="fixed z-[210] min-w-[120px] overflow-hidden rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] py-1 text-xs shadow-lg"
          style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { setPreview(menu.m); setMenu(null); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
            <Eye className="h-3.5 w-3.5" /> 预览
          </button>
          <button type="button"
            onClick={async () => {
              const m = menu.m; setMenu(null);
              if (!(await confirmDialog(`删除素材「${m.name}」?磁盘文件会一并清掉。`, { danger: true }))) return;
              await delMut.mutateAsync(m.material_id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </button>
        </div>
      )}
      {preview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreview(null)}>
          <div className="max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
            {isImg(preview) ? (
              <img src={vgMaterialFileUrl(preview.material_id)} alt={preview.name} className="max-h-[85vh] max-w-[85vw] rounded-lg" />
            ) : isAudio(preview) ? (
              // 不 autoPlay:桌面 webview 对"无元素手势的自动播放"会强制静音;点原生播放键(真手势)才稳出声
              <audio src={vgMaterialFileUrl(preview.material_id)} controls className="w-[80vw] max-w-xl" />
            ) : (
              <video src={vgMaterialFileUrl(preview.material_id)} controls playsInline className="max-h-[85vh] max-w-[85vw] rounded-lg" />
            )}
          </div>
        </div>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────
/** 在线素材源 API Key 管理(去申请 + 设置 Key)——复用 OnlineSourceChips。可折叠。 */
const OnlineKeyManager: React.FC<{ source: 'pexels' | 'pixabay'; onSelectSearchable: (n: 'pexels' | 'pixabay') => void }> = ({ source, onSelectSearchable }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
        <KeyRound className="h-3.5 w-3.5" /> 在线源 API Key(去申请 / 设置)
        <span className="ml-auto text-[var(--cy-text-tertiary)]">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5">
          <OnlineSourceChips
            selected={source}
            onSelect={(n) => { if (n === 'pexels' || n === 'pixabay') onSelectSearchable(n); }}
          />
        </div>
      )}
    </div>
  );
};

// 在线搜索
// ─────────────────────────────────────────────────────────────────────

const OnlineTab: React.FC<{
  selected: VgMaterialInfo[];
  onToggle: (item: VgMaterialInfo) => void;
  aspect: '16:9' | '9:16' | '1:1';
  qc: ReturnType<typeof useQueryClient>;
  view?: 'card' | 'list';
}> = ({ selected, onToggle, aspect, qc, view = 'card' }) => {
  void view; // 在线搜索结果保持卡片视图;列表视图主要服务「我的素材」
  void qc;   // 不再做「加入素材库」,qc 暂留接口
  void selected; void onToggle; // 在线素材不可删/不做选中,仅拖拽使用
  const [source, setSource] = React.useState<'pexels' | 'pixabay'>('pexels');
  const [keyword, setKeyword] = React.useState('');
  const [results, setResults] = React.useState<VgMaterialInfo[]>([]);
  const [translated, setTranslated] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);

  const onSearch = React.useCallback(async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setError(null);
    setTranslated(null);
    try {
      const r = await videoGeneration.searchMaterials({ q: keyword, source, aspect, minimum_duration: 5 });
      setResults(r.items);
      setTranslated(r.translated_query ?? null);
      if (r.items.length === 0) setError('未搜到结果 — 换个关键词试试');
    } catch (e) {
      const err = e as Error;
      if (err.message.includes('412') || /key/i.test(err.message)) {
        setError(`${source.toUpperCase()} API Key 未配置 — 请在对话输入框上方「素材设置」里配置`);
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
      <OnlineKeyManager source={source} onSelectSearchable={(n) => setSource(n)} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(['pexels', 'pixabay'] as const).map((s) => (
            <button type="button" key={s} onClick={() => setSource(s)}
              className={'rounded-md border px-2 py-1 text-xs ' +
                (source === s ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                              : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')}>
              {s}
            </button>
          ))}
        </div>
        <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          placeholder="任意语言关键词 — 中文会自动转英文再搜"
          className="min-w-[14rem] flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]" />
        <button type="button" onClick={onSearch} disabled={searching || !keyword.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50">
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 搜索
        </button>
      </div>

      {translated && (
        <p className="text-[11px] text-[var(--cy-text-tertiary)]">已转换为英文关键词:<span className="font-medium text-[var(--cy-text-secondary)]">{translated}</span></p>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {results.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((item, i) => {
            return (
              <li key={`${item.url}-${i}`}
                draggable
                onDragStart={(e) => setDragData(e, {
                  url: item.url,
                  kind: /\.(jpg|jpeg|png|webp|bmp|gif)(\?|$)/i.test(item.url) ? 'image' : 'video',
                  durationMs: item.duration ? item.duration * 1000 : undefined,
                  // 在线视频本身不是图,带上服务端缩略图(Pexels item.image)→ 时间轴才有预览;
                  // 缺缩略图(Pixabay 常缺)留空,onDropMaterial 的 probe 会补时长,预览回退视频首帧。
                  thumbnailUrl: item.image || undefined,
                })}
                className="group relative cursor-grab overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] transition-colors hover:border-[var(--cy-border-strong)] active:cursor-grabbing"
                title="拖到时间轴视频轨">
                <PlayBadge image={/\\.(jpg|jpeg|png|webp|bmp|gif)(\\?|$)/i.test(item.url)} onClick={() => setPreview(item.url)} />
                <div className="relative aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center overflow-hidden text-xs text-[var(--cy-text-tertiary)]">
                  {/* 有服务端缩略图(Pexels)用 img;没有(Pixabay 常缺)才用视频首帧兜底 */}
                  {item.image
                    ? <img src={item.image} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" />
                    : <video src={`${item.url}#t=0.1`} muted preload="metadata" draggable={false} className="h-full w-full object-cover" />}
                  <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[9px] text-white">{item.duration}s</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreview(null)}>
          <video src={preview} controls autoPlay onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[85vw] rounded-lg bg-black" />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 从链接提取多媒体
// ─────────────────────────────────────────────────────────────────────

const LinkTab: React.FC<{ qc: ReturnType<typeof useQueryClient> }> = ({ qc }) => {
  const [url, setUrl] = React.useState('');
  const [items, setItems] = React.useState<import('@chayuan/api').VgMediaItem[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [ingesting, setIngesting] = React.useState(false);
  const [pv, setPv] = React.useState<import('@chayuan/api').VgMediaItem | null>(null);

  const onExtract = React.useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true); setError(null); setItems([]); setPicked(new Set());
    try {
      const r = await videoGeneration.extractMedia(url.trim());
      setItems(r.items);
      if (r.items.length === 0) setError('该链接未发现可提取的图片/视频');
    } catch (e) {
      setError((e as Error).message || '提取失败');
    } finally {
      setLoading(false);
    }
  }, [url]);

  const toggle = (u: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u); else next.add(u);
      return next;
    });
  };

  const onIngestPicked = React.useCallback(async () => {
    if (picked.size === 0) return;
    setIngesting(true);
    try {
      for (const u of picked) {
        const it = items.find((x) => x.url === u);
        if (!it) continue;
        try {
          await videoGeneration.ingestMedia({ url: it.url, kind: it.kind, source: 'url' });
        } catch (e) {
          reportError(e as Error, `加入失败:${it.url}`);
        }
      }
      await qc.invalidateQueries({ queryKey: ['vg.materials'] });
      setPicked(new Set());
    } finally {
      setIngesting(false);
    }
  }, [picked, items, qc]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onExtract(); }}
          placeholder="粘贴网页 / 视频平台链接 — 提取页面里的图片和视频"
          className="min-w-[16rem] flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]" />
        <button type="button" onClick={onExtract} disabled={loading || !url.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} 提取
        </button>
      </div>
      <p className="text-[10px] text-[var(--cy-text-tertiary)]">⚠ 仅限 CC0/自有素材,版权风险用户自负</p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--cy-text-tertiary)]">找到 {items.length} 个媒体 · 已选 {picked.size}</span>
            <button type="button" onClick={onIngestPicked} disabled={picked.size === 0 || ingesting}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
              {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 批量加入素材库
            </button>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it, i) => {
              const chosen = picked.has(it.url);
              return (
                <li key={`${it.url}-${i}`}
                  draggable
                  onDragStart={(e) => setDragData(e, { url: it.url, kind: it.kind })}
                  className={'group relative overflow-hidden rounded-xl border transition-colors ' +
                    (chosen ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                            : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')}>
                  <PlayBadge image={it.kind === 'image'} onClick={() => setPv(it)} />
                  <button type="button" onClick={() => toggle(it.url)} className="block w-full cursor-grab text-left active:cursor-grabbing" title="拖到时间轴 / 点选批量加入素材库">
                    <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center overflow-hidden text-xs text-[var(--cy-text-tertiary)]">
                      {it.thumb ? <img src={it.thumb} alt="" draggable={false} className="h-full w-full object-cover" loading="lazy" />
                                : (it.kind === 'video' ? '🎬 视频' : '🖼 图片')}
                    </div>
                    <p className="truncate p-2 text-[10px] text-[var(--cy-text-tertiary)]">{it.title || it.url.split('/').pop()}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {pv && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6" onClick={() => setPv(null)}>
          {pv.kind === 'image'
            ? <img src={pv.url} alt="" onClick={(e) => e.stopPropagation()} className="max-h-[85vh] max-w-[85vw] rounded-lg" />
            : <video src={pv.url} controls autoPlay onClick={(e) => e.stopPropagation()} className="max-h-[85vh] max-w-[85vw] rounded-lg bg-black" />}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// AI 生成
// ─────────────────────────────────────────────────────────────────────

const AiGenTab: React.FC<{ qc: ReturnType<typeof useQueryClient> }> = ({ qc }) => {
  const onGenerated = async (url: string) => {
    try {
      await ingestAiVideo(url);
      await qc.invalidateQueries({ queryKey: ['vg.materials'] });
    } catch {
      /* 生成成功但落库失败:静默,用户可去 /ai-video 重试导入 */
    }
  };
  return (
    <div className="px-1 py-2">
      <p className="mb-2 text-[11px] text-[var(--cy-text-tertiary)]">
        用 AI 生成视频片段,生成后自动加入「我的素材」,拖到下方轨道即可使用。
      </p>
      <AiVideoGenerator compact onGenerated={(u) => void onGenerated(u)} />
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

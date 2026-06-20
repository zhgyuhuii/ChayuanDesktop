/**
 * 我的视频页 — 列已生成的成品视频。
 *
 * 时间线分组(今天 / 本周 / 本月 / 更早)+ 内嵌播放器 + 下载 + 删除 +
 * 复制参数重做(把 video.params_snapshot 写回 vgComposer 并跳 wizard step 7)。
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getPlatform } from '@chayuan/platform-shared';
import { Download, RefreshCw, Trash2, LayoutGrid, List as ListIcon, Play, FileText, Captions, X, CheckSquare, Square } from 'lucide-react';
import {
  videoGeneration,
  vgTaskFileUrl,
  type VgVideo,
  type VgVideoParams,
  VG_DEFAULT_PARAMS,
} from '@chayuan/api';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer } from './store/vgComposer';
import { VgTaskListPanel } from './VgTaskListPanel';
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
  const [viewMode, setViewMode] = React.useState<'card' | 'list'>('card');
  const [tab, setTab] = React.useState<'videos' | 'tasks'>('videos');
  const [selectedVideoId, setSelectedVideoId] = React.useState<string | null>(null);
  const [multiSelect, setMultiSelect] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const cardRefs = React.useRef<Record<string, HTMLLIElement | null>>({});

  // 从「视频任务」tab 点「查看视频」→ 切到 videos tab + 滚动到 + 选中对应成片
  const onViewVideo = React.useCallback((taskId: string) => {
    const vid = (q.data?.items ?? []).find((v) => v.task_id === taskId);
    setTab('videos');
    if (vid) setSelectedVideoId(vid.video_id);
  }, [q.data]);

  React.useEffect(() => {
    if (tab !== 'videos' || !selectedVideoId) return;
    const el = cardRefs.current[selectedVideoId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => setSelectedVideoId(null), 2500); // 2.5s 后撤高亮
      return () => clearTimeout(t);
    }
    return undefined;
  }, [tab, selectedVideoId, items.length]);

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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3 overflow-y-auto cy-hide-scrollbar px-6 py-4">
      <header className="flex items-center justify-end gap-3 empty:hidden">
        {/* 视图切换 + 多选(仅「我的视频」tab) */}
        {tab === 'videos' && (
          <div className="flex shrink-0 items-center gap-2">
            {multiSelect ? (
              <>
                <button type="button" onClick={async () => {
                  if (selectedIds.size === 0) return;
                  if (!(await confirmDialog(`删除选中的 ${selectedIds.size} 个视频?磁盘文件会一并清掉。`, { danger: true }))) return;
                  for (const id of selectedIds) { try { await deleteMut.mutateAsync(id); } catch (e) { reportError(e as Error); } }
                  setSelectedIds(new Set()); setMultiSelect(false);
                }} disabled={selectedIds.size === 0}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs text-rose-700 hover:border-rose-300 disabled:opacity-50">
                  <Trash2 className="h-3.5 w-3.5" /> 删除选中 ({selectedIds.size})
                </button>
                <button type="button" onClick={() => setSelectedIds(new Set(items.map((v) => v.video_id)))}
                  className="inline-flex h-8 items-center rounded-lg border border-[var(--cy-border-subtle)] px-3 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">全选</button>
                <button type="button" onClick={() => { setMultiSelect(false); setSelectedIds(new Set()); }}
                  className="inline-flex h-8 items-center rounded-lg border border-[var(--cy-border-subtle)] px-3 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">取消</button>
              </>
            ) : (
              <button type="button" onClick={() => setMultiSelect(true)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] px-3 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
                <CheckSquare className="h-3.5 w-3.5" /> 多选
              </button>
            )}
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--cy-border-subtle)]">
              <button type="button" onClick={() => setViewMode('card')} title="卡片视图"
                className={'inline-flex h-8 w-8 items-center justify-center ' + (viewMode === 'card' ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setViewMode('list')} title="列表视图"
                className={'inline-flex h-8 w-8 items-center justify-center border-l border-[var(--cy-border-subtle)] ' + (viewMode === 'list' ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
                <ListIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Tab 切换:我的视频 / 视频任务 */}
      <div className="flex gap-1 border-b border-[var(--cy-border-subtle)]">
        {(['videos', 'tasks'] as const).map((tb) => (
          <button key={tb} type="button" onClick={() => setTab(tb)}
            className={'-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ' +
              (tab === tb ? 'border-[var(--cy-brand-500)] text-[var(--cy-brand-700)]' : 'border-transparent text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]')}>
            {tb === 'videos' ? '我的视频' : '视频任务'}
          </button>
        ))}
      </div>

      {tab === 'tasks' ? (
        <VgTaskListPanel onViewVideo={onViewVideo} />
      ) : (
        <>
          {q.isLoading && <p className="text-sm text-[var(--cy-text-tertiary)]">加载中…</p>}
          {q.isError && (
            <p className="text-xs text-rose-700">加载失败:{(q.error as Error).message}</p>
          )}
          {items.length === 0 && q.isFetched && (
            <div className="rounded-xl border-2 border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center">
              <p className="text-sm text-[var(--cy-text-secondary)]">还没有成品</p>
              <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
                到「视频生成」生成,或在「视频任务」tab 看进度
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
                <ul className={viewMode === 'card' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-1.5'}>
                  {grouped[bucket].map((v) => (
                    <VideoCard
                      key={v.video_id}
                      v={v}
                      mode={viewMode}
                      selected={selectedVideoId === v.video_id}
                      multiSelect={multiSelect}
                      checked={selectedIds.has(v.video_id)}
                      onToggleSelect={() => toggleSel(v.video_id)}
                      cardRef={(el) => { cardRefs.current[v.video_id] = el; }}
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
        </>
      )}
    </div>
  );
};

/** 视频卡的「脚本」「字幕」两个图标按钮 + 内容查看浮层。卡片/列表两处复用。 */
const ScriptSubtitleButtons: React.FC<{ v: VgVideo }> = ({ v }) => {
  const [open, setOpen] = React.useState<'script' | 'subtitle' | null>(null);
  const [subtitle, setSubtitle] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const script = (v.params_snapshot?.video_script || '').trim();

  const openSubtitle = async () => {
    setOpen('subtitle');
    if (subtitle !== null) return;
    setLoading(true);
    try {
      const { blob } = await videoGeneration.downloadTaskFile(v.task_id, 'subtitle.srt');
      setSubtitle((await blob.text()).trim() || '(空字幕)');
    } catch {
      setSubtitle('(无字幕文件)');
    } finally {
      setLoading(false);
    }
  };

  const iconBtn = 'inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]';
  const content = open === 'script' ? (script || '(无脚本)') : (loading ? '加载中…' : (subtitle ?? ''));

  return (
    <>
      <button type="button" onClick={() => setOpen('script')} className={iconBtn} title="查看脚本">
        <FileText className="h-3 w-3" /> 脚本
      </button>
      <button type="button" onClick={() => void openSubtitle()} className={iconBtn} title="查看字幕">
        <Captions className="h-3 w-3" /> 字幕
      </button>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={() => setOpen(null)}>
          <div className="flex max-h-[80vh] w-[min(640px,90vw)] flex-col rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-2.5">
              <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">
                {open === 'script' ? '脚本' : '字幕'} · {v.title || '未命名视频'}
              </h3>
              <button type="button" onClick={() => setOpen(null)} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar whitespace-pre-wrap break-words px-4 py-3 text-xs leading-relaxed text-[var(--cy-text-secondary)]">
              {content}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};

const VideoCard: React.FC<{
  v: VgVideo;
  mode?: 'card' | 'list';
  selected?: boolean;
  multiSelect?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  cardRef?: (el: HTMLLIElement | null) => void;
  onCopyRedo: () => void;
  onDelete: () => void;
}> = ({ v, mode = 'card', selected = false, multiSelect = false, checked = false, onToggleSelect, cardRef, onCopyRedo, onDelete }) => {
  const checkbox = multiSelect ? (
    <button type="button" onClick={onToggleSelect} title={checked ? '取消选择' : '选择'}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)]">
      {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-[var(--cy-text-tertiary)]" />}
    </button>
  ) : null;
  const name = v.path.split(/[\\/]/).pop() || `${v.video_id}.mp4`;
  const playUrl = vgTaskFileUrl(v.task_id, name, false);
  const [downloading, setDownloading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  // Tauri webview 里 <a download> 不触发下载 → fetch 成 blob 后程序化 anchor 点击。
  // 保存用的友好文件名 = 概括标题(去非法字符),而非磁盘上的 final-0.mp4
  const dlName = `${(v.title || '视频').replace(/[\\/:*?"<>|·]/g, '_').replace(/\s+/g, '_').slice(0, 40)}.mp4`;
  const onDownload = async () => {
    setDownloading(true);
    try {
      const { blob } = await videoGeneration.downloadTaskFile(v.task_id, name);
      // 走平台抽象:Tauri 弹原生「保存位置」对话框 + 写文件;web 用 showSaveFilePicker/anchor。
      await getPlatform().fs.saveBinary(dlName, blob);
    } catch (e) {
      reportError(e as Error, '下载失败');
    } finally {
      setDownloading(false);
    }
  };
  const meta = `${v.width || '?'}×${v.height || '?'}${v.duration_ms ? ` · ${Math.round(v.duration_ms / 1000)}s` : ''}${v.created_at ? ` · ${new Date(v.created_at).toLocaleString()}` : ''}`;
  const iconBtn = 'inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)] disabled:opacity-50';

  // 列表视图:紧凑一行,点播放展开内嵌播放器
  if (mode === 'list') {
    return (
      <li ref={cardRef} className={'rounded-lg border bg-[var(--cy-surface-base)] ' + (selected ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/40' : 'border-[var(--cy-border-subtle)]')}>
        <div className="flex items-center gap-2 px-3 py-2">
          {checkbox}
          <button type="button" onClick={() => setExpanded((x) => !x)} title="播放/收起"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]">
            <Play className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--cy-text-primary)]" title={v.title || '未命名视频'}>{v.title || '未命名视频'}</p>
            <p className="truncate text-[10px] text-[var(--cy-text-tertiary)]">{meta}</p>
          </div>
          <button type="button" onClick={() => void onDownload()} disabled={downloading} className={iconBtn} title="下载">
            <Download className="h-3 w-3" /> {downloading ? '…' : '下载'}
          </button>
          <button type="button" onClick={onCopyRedo} className={iconBtn} title="用参数重做">
            <RefreshCw className="h-3 w-3" /> 重做
          </button>
          <ScriptSubtitleButtons v={v} />
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700 hover:border-rose-300" title="删除">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {expanded && (
          <video src={playUrl} controls autoPlay preload="metadata" className="w-full bg-black"
            style={{ maxHeight: '40vh' }} />
        )}
      </li>
    );
  }

  return (
    <li ref={cardRef} className={'relative overflow-hidden rounded-xl border bg-[var(--cy-surface-base)] ' + (selected ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/40' : (checked ? 'border-[var(--cy-brand-500)]' : 'border-[var(--cy-border-subtle)]'))}>
      {multiSelect && (
        <div className="absolute left-2 top-2 z-10 rounded bg-black/55 p-0.5">{checkbox}</div>
      )}
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
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={downloading}
            className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)] disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> {downloading ? '下载中…' : '下载'}
          </button>
          <button
            type="button"
            onClick={onCopyRedo}
            className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
          >
            <RefreshCw className="h-3 w-3" /> 用参数重做
          </button>
          <ScriptSubtitleButtons v={v} />
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

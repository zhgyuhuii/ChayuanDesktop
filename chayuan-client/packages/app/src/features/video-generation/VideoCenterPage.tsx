/**
 * 视频中心 — 把「图文成片」(VG) 与「数字人视频」(DH) 整合到一个页面。
 *
 * 布局:顶部 header(标题 + 视图切换)+ 来源筛选 chips + 「生成中」独立区
 * (DH 进行中/失败任务)+ 已完成统一网格(VG + DH 按时间倒序混排,卡片带来源徽标)。
 * 操作按来源适配:VG 可下载/删除/复制参数重做;DH 可下载/删除。
 */
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getPlatform } from '@chayuan/platform-shared';
import {
  Download, Trash2, RefreshCw, LayoutGrid, List as ListIcon, Play,
  Clapperboard, UserRound, Loader2, AlertTriangle, CheckSquare, Square,
} from 'lucide-react';
import {
  videoGeneration, digitalHuman,
  type VgVideo, type VgVideoParams, type DhTaskStatus, VG_DEFAULT_PARAMS,
} from '@chayuan/api';
import { useUnifiedVideos } from './useUnifiedVideos';
import { type UnifiedVideo } from './unifiedVideos';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer } from './store/vgComposer';
import { reportError } from '../../store/errorDialog';
import { confirmDialog } from '../../store/confirmDialog';
import { downloadUrlAsFile } from '../../lib/downloadMedia';

type Filter = 'all' | 'vg';
const FILTER_LABEL: Record<Filter, string> = { all: '全部', vg: '图文成片' };

const safeName = (title: string) =>
  `${(title || '视频').replace(/[\\/:*?"<>|·]/g, '_').replace(/\s+/g, '_').slice(0, 40)}.mp4`;

export const VideoCenterPage: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const patchParams = useVgComposer((s) => s.patchParams);
  const setStep = useVgComposer((s) => s.setStep);
  const setActiveTaskId = useVgComposer((s) => s.setActiveTaskId);

  const { completed, active, isLoading, vgError } = useUnifiedVideos();
  const [view, setView] = React.useState<'card' | 'list'>('card');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [multiSel, setMultiSel] = React.useState(false);
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(() => new Set());

  const shown = React.useMemo(
    () => (filter === 'all' ? completed : completed.filter((v) => v.source === filter)),
    [completed, filter],
  );

  const delVg = useMutation({
    mutationFn: (id: string) => videoGeneration.deleteVideo(id, { drop_file: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vg.videos'] }),
  });
  const delDh = useMutation({
    mutationFn: (tid: string) => digitalHuman.deleteTask(tid),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dh.tasks'] }),
  });

  const onDownload = async (u: UnifiedVideo) => {
    try {
      if (u.source === 'vg') {
        const v = u.raw as VgVideo;
        const name = v.path.split(/[\\/]/).pop() || `${v.video_id}.mp4`;
        const { blob } = await videoGeneration.downloadTaskFile(v.task_id, name);
        await getPlatform().fs.saveBinary(safeName(u.title), blob);
      } else {
        await downloadUrlAsFile(safeName(u.title), u.fileUrl);
      }
    } catch (e) {
      reportError(e as Error, '下载失败');
    }
  };

  const onDelete = async (u: UnifiedVideo) => {
    if (!(await confirmDialog(`删除「${u.title}」?磁盘文件会一并清掉。`, { danger: true }))) return;
    try {
      if (u.source === 'vg') await delVg.mutateAsync((u.raw as VgVideo).video_id);
      else await delDh.mutateAsync((u.raw as DhTaskStatus).task_id);
    } catch (e) {
      reportError(e as Error);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 暂隐藏,保留待恢复
  const onCopyRedo = (v: VgVideo) => {
    const merged: VgVideoParams = { ...VG_DEFAULT_PARAMS, ...(v.params_snapshot as Partial<VgVideoParams>) };
    patchParams(merged);
    setActiveTaskId(null);
    setStep(7);
    openTab('/video-generation', { title: '视频生成', icon: 'video' });
    void navigate({ to: '/video-generation' as never });
  };

  const toggleSel = (k: string) => setSelectedKeys((p) => {
    const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n;
  });
  const selectAll = () => setSelectedKeys(new Set(shown.map((v) => v.key)));
  const invertSel = () => setSelectedKeys((p) => {
    const n = new Set<string>(); for (const v of shown) if (!p.has(v.key)) n.add(v.key); return n;
  });
  const exitMulti = () => { setMultiSel(false); setSelectedKeys(new Set()); };
  const onDeleteSelected = async () => {
    if (selectedKeys.size === 0) return;
    if (!(await confirmDialog(`删除选中的 ${selectedKeys.size} 个视频?磁盘文件会一并清掉。`, { danger: true }))) return;
    const map = new Map(shown.map((v) => [v.key, v] as const));
    for (const k of selectedKeys) {
      const u = map.get(k);
      if (!u) continue;
      try {
        if (u.source === 'vg') await delVg.mutateAsync((u.raw as VgVideo).video_id);
        else await delDh.mutateAsync((u.raw as DhTaskStatus).task_id);
      } catch (e) { reportError(e as Error); }
    }
    exitMulti();
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3 overflow-y-auto cy-hide-scrollbar px-6 py-4">
      {/* 来源筛选 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'vg'] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={'rounded-full border px-3 py-1 text-xs transition-colors ' +
              (filter === f
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
            {FILTER_LABEL[f]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[var(--cy-border-subtle)]">
          <button type="button" onClick={() => setView('card')} title="卡片视图"
            className={'inline-flex h-8 w-8 items-center justify-center ' + (view === 'card' ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setView('list')} title="列表视图"
            className={'inline-flex h-8 w-8 items-center justify-center border-l border-[var(--cy-border-subtle)] ' + (view === 'list' ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
          {!multiSel ? (
            <button type="button" onClick={() => setMultiSel(true)} disabled={shown.length === 0}
              className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)] disabled:opacity-50">
              <CheckSquare className="h-3.5 w-3.5" /> 多选
            </button>
          ) : (
            <>
              <button type="button" onClick={selectAll}
                className="inline-flex items-center rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">全选</button>
              <button type="button" onClick={invertSel}
                className="inline-flex items-center rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">反选</button>
              <button type="button" onClick={() => void onDeleteSelected()} disabled={selectedKeys.size === 0}
                className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:border-rose-300 disabled:opacity-50">
                <Trash2 className="h-3 w-3" /> 删除选中 ({selectedKeys.size})
              </button>
              <button type="button" onClick={exitMulti}
                className="inline-flex items-center rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">退出</button>
            </>
          )}
        </div>
      </div>

      {vgError && (
        <p className="text-xs text-rose-700">图文成片加载失败。</p>
      )}
      {isLoading && <p className="text-sm text-[var(--cy-text-tertiary)]">加载中…</p>}

      {/* 生成中独立区(数字人进行中/失败) */}
      {active.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--cy-text-tertiary)]">
            生成中 · {active.length}
          </h2>
          <div className="flex flex-wrap gap-2">
            {active.map((u) => (
              <div key={u.key} className="flex w-56 items-center gap-2 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-2">
                {u.state === 'failed' ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--cy-brand-500)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--cy-text-primary)]" title={u.title}>{u.title}</p>
                  <p className="text-[10px] text-[var(--cy-text-tertiary)]">
                    {u.state === 'failed' ? '生成失败' : `生成中 ${u.progress ?? 0}%`}
                  </p>
                </div>
                <button type="button" onClick={() => void onDelete(u)} title="删除"
                  className="shrink-0 text-[var(--cy-text-tertiary)] hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 已完成统一网格 */}
      {shown.length === 0 && !isLoading ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center">
          <p className="text-sm text-[var(--cy-text-secondary)]">还没有视频</p>
          <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">到「视频生成」生成后会在这里汇总</p>
        </div>
      ) : (
        <ul className={view === 'card' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-1.5'}>
          {shown.map((u) => (
            <UnifiedCard
              key={u.key} u={u} mode={view}
              multiSel={multiSel}
              checked={selectedKeys.has(u.key)}
              onToggleSelect={() => toggleSel(u.key)}
              onDownload={() => void onDownload(u)}
              onDelete={() => void onDelete(u)}
              // 「用参数重做」暂隐藏:参数未正确传回,修好前不在视频中心卡片暴露(逻辑保留:onCopyRedo)
              onCopyRedo={undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const SourceBadge: React.FC<{ source: 'vg' | 'dh' }> = ({ source }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
    {source === 'vg' ? <Clapperboard className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
    {source === 'vg' ? '图文成片' : '数字人'}
  </span>
);

const UnifiedCard: React.FC<{
  u: UnifiedVideo;
  mode: 'card' | 'list';
  multiSel?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCopyRedo?: () => void;
}> = ({ u, mode, multiSel = false, checked = false, onToggleSelect, onDownload, onDelete, onCopyRedo }) => {
  const [expanded, setExpanded] = React.useState(false);
  const meta = `${u.width || '?'}×${u.height || '?'}${u.durationMs ? ` · ${Math.round(u.durationMs / 1000)}s` : ''}${u.createdAt ? ` · ${new Date(u.createdAt).toLocaleString()}` : ''}`;
  const iconBtn = 'inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[10px] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]';

  if (mode === 'list') {
    return (
      <li className={'rounded-lg border bg-[var(--cy-surface-base)] ' + (checked ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/40' : 'border-[var(--cy-border-subtle)]')}>
        <div className="flex items-center gap-2 px-3 py-2">
          {multiSel && (
            <button type="button" onClick={onToggleSelect} title={checked ? '取消选择' : '选择'}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--cy-brand-600)]">
              {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-[var(--cy-text-tertiary)]" />}
            </button>
          )}
          <button type="button" onClick={() => setExpanded((x) => !x)} title="播放/收起"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]">
            <Play className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--cy-text-primary)]" title={u.title}>
              <SourceBadge source={u.source} /> {u.title}
            </p>
            <p className="truncate text-[10px] text-[var(--cy-text-tertiary)]">{meta}</p>
          </div>
          <button type="button" onClick={onDownload} className={iconBtn} title="下载"><Download className="h-3 w-3" /> 下载</button>
          {onCopyRedo && <button type="button" onClick={onCopyRedo} className={iconBtn} title="用参数重做"><RefreshCw className="h-3 w-3" /> 重做</button>}
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700 hover:border-rose-300" title="删除"><Trash2 className="h-3 w-3" /></button>
        </div>
        {expanded && u.fileUrl && (
          <video src={u.fileUrl} controls autoPlay preload="metadata" className="w-full bg-black" style={{ maxHeight: '40vh' }} />
        )}
      </li>
    );
  }

  return (
    <li className={'relative overflow-hidden rounded-xl border bg-[var(--cy-surface-base)] ' + (checked ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/40' : 'border-[var(--cy-border-subtle)]')}>
      <div className="absolute left-2 top-2 z-10"><SourceBadge source={u.source} /></div>
      {multiSel && (
        <span className="absolute right-2 top-2 z-30 rounded bg-black/55 p-0.5 text-white">
          {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        </span>
      )}
      {multiSel && (
        <button type="button" onClick={onToggleSelect} title={checked ? '取消选择' : '选择'}
          className="absolute inset-0 z-20" />
      )}
      <video src={u.fileUrl} controls preload="metadata" className="w-full bg-black"
        style={{ aspectRatio: u.width && u.height ? `${u.width} / ${u.height}` : '9 / 16', maxHeight: '40vh' }} />
      <div className="p-3">
        <p className="truncate text-sm font-medium text-[var(--cy-text-primary)]" title={u.title}>{u.title}</p>
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">{meta}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={onDownload} className={iconBtn}><Download className="h-3 w-3" /> 下载</button>
          {onCopyRedo && <button type="button" onClick={onCopyRedo} className={iconBtn}><RefreshCw className="h-3 w-3" /> 用参数重做</button>}
          <button type="button" onClick={onDelete} className="ml-auto inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700 hover:border-rose-300"><Trash2 className="h-3 w-3" /> 删除</button>
        </div>
      </div>
    </li>
  );
};

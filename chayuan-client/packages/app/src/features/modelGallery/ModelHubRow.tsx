/**
 * 模型广场列表行 —— 展示一个 HubModelCard,并接通安装 / 卸载。
 *
 * 一行:display_name + owner(小字)、能力徽标、参数大小、文件大小、下载/点赞、
 * serveable===false 时的灰标「暂无本地运行服务」,右侧操作区。
 *
 * 操作区状态机(右侧):
 *   - 安装中(useInstallJob isInstalling 或终态展示)→ 行内进度条 + 文案 + 取消 / 重试;
 *   - card.installed===true → 「已安装」徽标 + 「卸载」按钮(内置模型禁用);
 *   - 否则 → 「安装」按钮:点开先看可运行文件数,>=2 弹 HubFilePickerDialog 选 quant/revision,
 *     否则直接 start(后端自选文件)。
 *
 * 联动:装完 / 卸完调用 props.onMutated() → 由 ModelGalleryPage invalidate
 * ['v1.models'] / ['runtime.models'] / ['model-hub.search'],刷新对话下拉 + 已安装态。
 *
 * 视觉:复用 marketplace/ProviderCard 同款 --cy-* 配色 + 圆角卡片风格。
 */

import { type HubModelCard, type InstallModelSource, modelHub } from '@chayuan/api';
import { cn } from '@chayuan/ui';
import {
  CheckCircle2,
  Download,
  Heart,
  Loader2,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { confirmDialog } from '../../store/confirmDialog';
import { reportError, useErrorDialog } from '../../store/errorDialog';
import { capabilityLabel } from './GalleryCapabilityChips';
import { HubFilePickerDialog } from './HubFilePickerDialog';
import { useInstallJob } from './useInstallJob';

/** 把字节数格式化成人类可读;null/0 → '—'。 */
export function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const prec = v >= 100 || i === 0 ? 0 : 1;
  return `${v.toFixed(prec)} ${units[i]}`;
}

/** 下载量紧凑显示(1.2k / 3.4M);null → null。 */
function formatCount(n: number | null): string | null {
  if (n == null || n < 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export interface ModelHubRowProps {
  card: HubModelCard;
  /** HF 线路提示(hf-mirror / official),透传给 detail / 安装文件挑选。 */
  route?: string;
  /** 源端可选 token(HF 私有 / 限流),透传给 detail。 */
  token?: string;
  /** 安装 / 卸载成功后回调 —— 父级据此 invalidate 相关 query。 */
  onMutated?(): void;
}

export const ModelHubRow: React.FC<ModelHubRowProps> = ({
  card,
  route,
  token,
  onMutated,
}) => {
  const downloads = formatCount(card.downloads);
  const likes = formatCount(card.likes);

  const { job, isInstalling, start, cancel, reset } = useInstallJob({
    onDone: () => onMutated?.(),
  });

  const [picking, setPicking] = React.useState(false);
  const [uninstalling, setUninstalling] = React.useState(false);

  // start 失败(start() reject)记一次,跟 job.status==='failed' 一起展示重试。
  const [startErr, setStartErr] = React.useState<string | null>(null);

  const doStart = React.useCallback(
    (file: string | undefined, revision?: string) => {
      setStartErr(null);
      void start({
        source: card.source as InstallModelSource,
        model_id: card.model_id,
        capability: card.capability,
        requested_file: file ?? null,
        revision: revision ?? null,
      }).catch((e) => {
        setStartErr(e instanceof Error ? e.message : String(e));
      });
    },
    [start, card.source, card.model_id, card.capability],
  );

  /** 点「安装」:先取文件清单判断是否需要让用户挑 quant。 */
  const onInstallClick = React.useCallback(async () => {
    setStartErr(null);
    try {
      const files = await modelHub.detail({
        source: card.source,
        modelId: card.model_id,
        route,
        token,
      });
      const runnable = files.filter((f) => f.runnable);
      if (runnable.length >= 2) {
        setPicking(true);
      } else {
        // 0/1 个可运行文件:直接下载,后端自选文件。
        doStart(undefined);
      }
    } catch (e) {
      // 文件清单拉取失败(如离线 / 私有仓无 token)→ 退化为默认下载,后端再报错。
      doStart(undefined);
      void e;
    }
  }, [card.source, card.model_id, route, token, doStart]);

  const onUninstall = React.useCallback(async () => {
    if (card.bundled) return;
    const ok = await confirmDialog('确定卸载该模型?将释放磁盘空间', {
      danger: true,
      title: '卸载模型',
      confirmText: '卸载',
    });
    if (!ok) return;

    setUninstalling(true);
    try {
      let res = await modelHub.uninstall({
        source: card.source,
        repoId: card.model_id,
      });

      if (!res.ok && res.reason === 'in_use') {
        const force = await confirmDialog(
          '该模型正在使用,卸载会停止其服务,继续?',
          { danger: true, title: '模型使用中', confirmText: '仍然卸载' },
        );
        if (!force) return;
        res = await modelHub.uninstall({
          source: card.source,
          repoId: card.model_id,
          force: true,
        });
      }

      if (res.ok) {
        const freed = res.freed_bytes ? `,释放 ${formatBytes(res.freed_bytes)}` : '';
        useErrorDialog.getState().show('已卸载', `已删除本地模型${freed}`, undefined, 2500, 'success');
        onMutated?.();
        return;
      }

      if (res.reason === 'bundled') {
        useErrorDialog.getState().show('无法卸载', '内置模型不可卸载', undefined, undefined, 'info');
      } else if (res.reason === 'not_found') {
        // 已不在本地:也刷新一下让行回未安装态。
        useErrorDialog.getState().show('未找到', '该模型已不在本地', undefined, 2500, 'info');
        onMutated?.();
      } else {
        useErrorDialog.getState().show('卸载失败', res.reason || '未知错误', undefined, undefined, 'error');
      }
    } catch (e) {
      reportError(e, '卸载失败');
    } finally {
      setUninstalling(false);
    }
  }, [card.bundled, card.source, card.model_id, onMutated]);

  // 任务状态展示:失败(job.status==='failed' 或 startErr)/ 取消可重试。
  const failed = startErr !== null || job?.status === 'failed';
  const cancelled = job?.status === 'cancelled';
  const showJob = isInstalling || failed || cancelled;
  const pct = Math.max(0, Math.min(100, Math.round(job?.progress_pct ?? 0)));
  const jobMsg =
    startErr ??
    (job?.status === 'failed'
      ? (job.log_tail?.[job.log_tail.length - 1] ?? '安装失败')
      : job?.progress_message || '');

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-4 py-3 transition-all',
        'hover:border-[var(--cy-brand-300)] hover:shadow-[var(--cy-shadow-sm)]',
      )}
    >
      {/* 主体:名 + owner + 元信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 truncate text-sm font-medium text-[var(--cy-text-primary)]"
            title={card.model_id}
          >
            {card.display_name || card.model_id}
          </span>
          {card.owner && (
            <span className="shrink-0 text-[11px] text-[var(--cy-text-tertiary)]">
              {card.owner}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--cy-text-tertiary)]">
          {/* 能力徽标 */}
          <span className="rounded-full bg-[var(--cy-surface-2)] px-1.5 py-0.5 text-[var(--cy-text-secondary)]">
            {capabilityLabel(card.capability)}
          </span>
          {/* 参数大小 */}
          <span title="参数规模">{card.param_size ?? '—'}</span>
          <span aria-hidden>·</span>
          {/* 文件大小 */}
          <span title="文件大小">{formatBytes(card.file_size_bytes)}</span>
          {card.format && (
            <>
              <span aria-hidden>·</span>
              <span className="uppercase">{card.format}</span>
            </>
          )}
          {downloads && (
            <span className="inline-flex items-center gap-0.5" title="下载量">
              <Download className="h-3 w-3" />
              {downloads}
            </span>
          )}
          {likes && (
            <span className="inline-flex items-center gap-0.5" title="点赞">
              <Heart className="h-3 w-3" />
              {likes}
            </span>
          )}
          {card.serveable === false && (
            <span
              className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500"
              title="该类模型(如文生图 / 文生视频)暂无本地运行服务,仅支持下载管理"
            >
              暂无本地运行服务
            </span>
          )}
        </div>
      </div>

      {/* 右侧操作区 */}
      <div className="flex min-w-[160px] shrink-0 items-center justify-end">
        {showJob ? (
          <div className="flex w-full flex-col items-end gap-1">
            {isInstalling ? (
              <>
                <div className="flex w-full items-center gap-2">
                  <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-[var(--cy-surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--cy-brand-500)] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--cy-text-secondary)]">
                    {pct}%
                  </span>
                  <button
                    type="button"
                    onClick={cancel}
                    title="取消下载"
                    className="shrink-0 rounded-full p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {jobMsg && (
                  <span className="max-w-full truncate text-[10px] text-[var(--cy-text-tertiary)]" title={jobMsg}>
                    {jobMsg}
                  </span>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className="max-w-[120px] truncate text-[11px] text-amber-600"
                  title={jobMsg || (cancelled ? '已取消' : '安装失败')}
                >
                  {cancelled ? '已取消' : '安装失败'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setStartErr(null);
                    void onInstallClick();
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)] px-2.5 py-1 text-[11px] font-medium text-[var(--cy-brand-600)] transition-colors hover:bg-[var(--cy-brand-100)]"
                >
                  <RotateCw className="h-3 w-3" />
                  重试
                </button>
              </div>
            )}
          </div>
        ) : card.installed ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已安装
            </span>
            <button
              type="button"
              disabled={card.bundled || uninstalling}
              onClick={onUninstall}
              title={card.bundled ? '内置模型不可卸载' : '卸载该模型'}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 py-1 text-[11px] font-medium text-[var(--cy-text-secondary)] transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--cy-border-subtle)] disabled:hover:bg-[var(--cy-surface-base)] disabled:hover:text-[var(--cy-text-secondary)]"
            >
              {uninstalling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              卸载
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void onInstallClick()}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)] px-3 py-1 text-[11px] font-medium text-[var(--cy-brand-600)] transition-colors hover:bg-[var(--cy-brand-100)]"
          >
            <Download className="h-3.5 w-3.5" />
            安装
          </button>
        )}
      </div>

      {/* 多 quant 文件挑选 */}
      {picking && (
        <HubFilePickerDialog
          card={card}
          route={route}
          token={token}
          onPick={(file, revision) => {
            setPicking(false);
            // revision 一路透传到后端下载器(HF/MS 的 revision= 参数);
            // 空则后端保持源默认分支(HF main / ModelScope master)。
            doStart(file, revision ?? undefined);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
};

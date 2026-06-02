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

import {
  type HubModelCard,
  type InstallModelSource,
  modelHub,
  serverCapabilityDefaults,
} from '@chayuan/api';
import { cn } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2,
  Download,
  FileText,
  Heart,
  Loader2,
  MessageSquare,
  RotateCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { confirmDialog } from '../../store/confirmDialog';
import { reportError, useErrorDialog } from '../../store/errorDialog';
import { useTabsStore } from '../../store/tabs';
import { capabilityLabel } from './GalleryCapabilityChips';
import { HubFilePickerDialog } from './HubFilePickerDialog';
import { HubReadmeDialog } from './HubReadmeDialog';
import { jobKey } from './installJobsStore';
import { useInstallJobFor } from './useInstallJob';

/**
 * hub capability(连字符词表)→ capability_defaults 的 cap key(chat/embedding/
 * clip/rerank/t2i/t2v/tts/asr/ocr)。用于「设为默认」时把模型写到对应 DEFAULT_*。
 * 未映射的能力(本机无运行服务)不显示「设为默认」。
 */
const HUB_CAP_TO_DEFAULT_CAP: Record<string, string> = {
  chat: 'chat',
  'text-embedding': 'embedding',
  rerank: 'rerank',
  'speech-to-text': 'asr',
  'text-to-audio': 'tts',
  'image-embedding': 'clip',
  'image-to-text': 'ocr',
  'text-to-image': 't2i',
  'text-to-video': 't2v',
};

/** 仓库 id 的末段(basename),用于把已装模型匹配到 capability_defaults 候选。 */
function repoBasename(modelId: string): string {
  return modelId.split('/').filter(Boolean).pop() ?? modelId;
}

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

  // 全局下载 store 索引 key = `source::model_id`(与本行的 React key 同构)。
  // 行 unmount / 翻页 / 搜索都不会丢进度 —— job state 与轮询都在全局 store。
  const key = jobKey(card.source, card.model_id);
  const { job, isInstalling, start, cancel, reset } = useInstallJobFor(key, {
    onDone: () => onMutated?.(),
  });

  const [picking, setPicking] = React.useState(false);
  const [readmeOpen, setReadmeOpen] = React.useState(false);
  const [uninstalling, setUninstalling] = React.useState(false);
  const navigate = useNavigate();

  // start 失败(start() reject)记一次,跟 job.status==='failed' 一起展示重试。
  const [startErr, setStartErr] = React.useState<string | null>(null);

  // 列表大小懒加载:HF search 结果常无 file_size_bytes(siblings 无 size)。
  // hover 时拉一次 detail 求和补大小;只对远程未安装、当前无大小、有 owner 的行启用。
  const isRemote = card.source === 'huggingface' || card.source === 'modelscope';
  const [hovered, setHovered] = React.useState(false);
  const needSizeProbe = isRemote && (card.file_size_bytes == null || card.file_size_bytes <= 0);
  const sizeQuery = useQuery({
    queryKey: ['model-hub.detail-size', card.source, card.model_id, route ?? null],
    queryFn: async () => {
      const files = await modelHub.detail({
        source: card.source,
        modelId: card.model_id,
        route,
        token,
      });
      return files.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);
    },
    enabled: needSizeProbe && hovered,
    staleTime: 5 * 60_000,
  });
  const shownSize =
    card.file_size_bytes && card.file_size_bytes > 0
      ? card.file_size_bytes
      : sizeQuery.data && sizeQuery.data > 0
        ? sizeQuery.data
        : null;

  // 「设为默认」:把刚装好的模型写到对应 capability 的 DEFAULT_*。
  const defaultCap = HUB_CAP_TO_DEFAULT_CAP[card.capability];
  const isChat = card.capability === 'chat';
  const [settingDefault, setSettingDefault] = React.useState(false);

  const onGoChat = React.useCallback(() => {
    // 复用主 /chat tab:开(或聚焦)一个 /chat tab 再路由过去。
    useTabsStore.getState().open('/chat', {
      title: '对话',
      icon: 'message-square',
    });
    void navigate({ to: '/chat' });
  }, [navigate]);

  const onSetDefault = React.useCallback(async () => {
    if (!defaultCap) return;
    setSettingDefault(true);
    try {
      // 解析要写入的真实模型 id:优先 capability_defaults 候选里匹配本仓的那条
      // (候选 id 可能是 local_index 归一 id,未必等于 hub repo id),匹配不到
      // 退回 hub repo id(后端按字符串落盘,扫描后仍能命中本地落地目录)。
      let modelId = card.model_id;
      try {
        const list = await serverCapabilityDefaults.list();
        const cands = list.candidates?.[defaultCap] ?? [];
        const base = repoBasename(card.model_id).toLowerCase();
        const hit =
          cands.find((c) => c.id === card.model_id) ??
          cands.find((c) => repoBasename(c.id).toLowerCase() === base) ??
          cands.find((c) => (c.path ?? '').toLowerCase().includes(base));
        if (hit) modelId = hit.id;
      } catch {
        // 候选拉取失败:用 hub repo id 兜底。
      }
      const res = await serverCapabilityDefaults.setMany({ [defaultCap]: modelId });
      const ok = res.results?.[defaultCap]?.ok;
      if (ok) {
        useErrorDialog
          .getState()
          .show('已设为默认', `${card.display_name || card.model_id} 已设为${capabilityLabel(card.capability)}默认模型`, undefined, 2500, 'success');
        onMutated?.();
      } else {
        useErrorDialog
          .getState()
          .show('设置失败', res.results?.[defaultCap]?.error || '未知错误', undefined, undefined, 'error');
      }
    } catch (e) {
      reportError(e, '设为默认失败');
    } finally {
      setSettingDefault(false);
    }
  }, [defaultCap, card.model_id, card.display_name, card.capability, onMutated]);

  const doStart = React.useCallback(
    (file: string | undefined, revision?: string, expectedBytes?: number | null) => {
      setStartErr(null);
      void start({
        source: card.source as InstallModelSource,
        model_id: card.model_id,
        capability: card.capability,
        requested_file: file ?? null,
        revision: revision ?? null,
        // 单文件下载用选中文件大小;整仓下载回退到卡片上的仓库总大小(可能为 null)。
        expected_bytes: expectedBytes ?? card.file_size_bytes ?? null,
      }).catch((e) => {
        setStartErr(e instanceof Error ? e.message : String(e));
      });
    },
    [start, card.source, card.model_id, card.capability, card.file_size_bytes],
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
  // 装完闭环:job 成功但行还没回到 installed 态(invalidate 刷新前)时展示 CTA。
  const justSucceeded = job?.status === 'succeeded' && !card.installed;
  const showJob = isInstalling || failed || cancelled;
  const pct = Math.max(0, Math.min(100, Math.round(job?.progress_pct ?? 0)));
  const jobMsg =
    startErr ??
    (job?.status === 'failed'
      ? (job.log_tail?.[job.log_tail.length - 1] ?? '安装失败')
      : job?.progress_message || '');

  // 装完 / 已安装态的行动入口:chat 能力 -> [去对话使用];可服务能力 -> [设为默认]。
  const ctaButtons = (
    <>
      {isChat && (
        <button
          type="button"
          onClick={onGoChat}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)] px-2.5 py-1 text-[11px] font-medium text-[var(--cy-brand-600)] transition-colors hover:bg-[var(--cy-brand-100)]"
        >
          <MessageSquare className="h-3 w-3" />
          去对话使用
        </button>
      )}
      {defaultCap && (
        <button
          type="button"
          disabled={settingDefault}
          onClick={onSetDefault}
          title={`设为${capabilityLabel(card.capability)}默认模型`}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 py-1 text-[11px] font-medium text-[var(--cy-text-secondary)] transition-colors hover:border-[var(--cy-brand-300)] hover:text-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {settingDefault ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Star className="h-3 w-3" />
          )}
          设为默认
        </button>
      )}
    </>
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
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
          {/* 文件大小(列表常无 → hover 懒加载 detail 求和补上) */}
          <span title="文件大小" className="inline-flex items-center gap-1">
            {needSizeProbe && sizeQuery.isFetching && shownSize == null ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              formatBytes(shownSize)
            )}
          </span>
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
          {/* 详情:懒加载该仓 README(点开才取),弹窗 markdown 预览 */}
          <button
            type="button"
            onClick={() => setReadmeOpen(true)}
            title="查看模型说明(README)"
            className="inline-flex items-center gap-0.5 text-[var(--cy-text-tertiary)] transition-colors hover:text-[var(--cy-brand-600)]"
          >
            <FileText className="h-3 w-3" />
            详情
          </button>
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
        ) : card.installed || justSucceeded ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已安装
            </span>
            {/* 装完闭环 CTA:去对话(chat)/ 设为默认(可服务能力) */}
            {ctaButtons}
            {/* 卸载:仅在行已确认 installed 时给(刚装完未刷新时先不显示,避免误删进行中态) */}
            {card.installed && (
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
            )}
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
          onPick={(file, revision, sizeBytes) => {
            setPicking(false);
            // revision 一路透传到后端下载器(HF/MS 的 revision= 参数);
            // 空则后端保持源默认分支(HF main / ModelScope master)。
            // sizeBytes=选中文件大小,透传给后端做磁盘空间预检。
            doStart(file, revision ?? undefined, sizeBytes);
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {/* README 详情预览(懒加载:打开才取) */}
      {readmeOpen && (
        <HubReadmeDialog
          card={card}
          route={route}
          token={token}
          onClose={() => setReadmeOpen(false)}
        />
      )}
    </div>
  );
};

/**
 * 模型广场列表行 —— 展示一个 HubModelCard。
 *
 * 一行:display_name + owner(小字)、能力徽标、参数大小、文件大小、下载/点赞、
 * 右侧操作区(已安装→徽标 / 否则「安装」按钮,本 Task 操作先占位,P5 接 useInstallJob)。
 * serveable===false 行显示灰标「暂无本地运行服务」。
 *
 * 视觉:复用 marketplace/ProviderCard 同款 --cy-* 配色 + 圆角卡片风格。
 */

import { type HubModelCard } from '@chayuan/api';
import { cn } from '@chayuan/ui';
import { CheckCircle2, Download, Heart } from 'lucide-react';
import * as React from 'react';
import { capabilityLabel } from './GalleryCapabilityChips';

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
  /** 安装按钮点击(P5 接 useInstallJob);占位时可不传。 */
  onInstall?(card: HubModelCard): void;
}

export const ModelHubRow: React.FC<ModelHubRowProps> = ({ card, onInstall }) => {
  const downloads = formatCount(card.downloads);
  const likes = formatCount(card.likes);

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
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500">
              暂无本地运行服务
            </span>
          )}
        </div>
      </div>

      {/* 右侧操作区 */}
      <div className="flex shrink-0 items-center">
        {card.installed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已安装
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (onInstall) {
                onInstall(card);
              } else {
                // P5 前占位:接 useInstallJob 之前先记录意图,避免静默无反馈。
                console.warn('[model-gallery] install not wired yet:', card.model_id);
              }
            }}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-brand-300)] bg-[var(--cy-brand-50)] px-3 py-1 text-[11px] font-medium text-[var(--cy-brand-600)] transition-colors hover:bg-[var(--cy-brand-100)]"
          >
            <Download className="h-3.5 w-3.5" />
            安装
          </button>
        )}
      </div>
    </div>
  );
};

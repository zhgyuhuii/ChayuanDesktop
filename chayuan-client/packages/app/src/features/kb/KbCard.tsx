/**
 * KbCard —— 知识库卡片(对齐 界面参考/知识库.jpg 设计稿)。
 *
 * 设计要点:
 *   - 白底 / soft border / hover 微浮起;不再用渐变条压顶
 *   - 第一行:粗标题(font-medium)
 *   - 第二行:描述 line-clamp-3,~12px,text-tertiary
 *   - 第三行:kind chip(PDF/IMG/DB/VEC,带颜色)+ 创建日期
 *   - 角标:右上 mine pill / hover 才出 checkbox(多选)
 *   - 选中态:整卡边框 + 右上勾选;以图搜库命中:玫粉环 + 分数 badge
 *
 * 可达性:整卡是 button,checkbox 单独按钮(stopPropagation 不冒泡到卡片 onOpen)。
 */

import * as React from 'react';
import { Boxes, CheckCheck, Database, FileText, Images, Lock } from 'lucide-react';
import { cn } from '@chayuan/ui';
import type { KuItem, KuKind } from '@chayuan/api';
import { KbDropZone } from './upload/KbDropZone';
import { KbProgressBar } from './components/KbProgressBar';

interface KindMeta {
  icon: React.ComponentType<{ className?: string }>;
  /** 类型 chip 文字 */
  label: string;
  /** "20 文件" 这种单位 */
  unit: string;
  /** chip 颜色 token(class 名) */
  chipBg: string;
  chipText: string;
  /** 角图标颜色 */
  iconBg: string;
  iconText: string;
}

const KIND: Record<KuKind, KindMeta> = {
  document: {
    icon: FileText,
    label: 'PDF',
    unit: '文件',
    chipBg: 'bg-sky-50',
    chipText: 'text-sky-700',
    iconBg: 'bg-sky-50',
    iconText: 'text-sky-600',
  },
  image: {
    icon: Images,
    label: 'IMG',
    unit: '图片',
    chipBg: 'bg-rose-50',
    chipText: 'text-rose-700',
    iconBg: 'bg-rose-50',
    iconText: 'text-rose-600',
  },
  structured: {
    icon: Database,
    label: 'DB',
    unit: '表',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    iconBg: 'bg-emerald-50',
    iconText: 'text-emerald-600',
  },
  vector: {
    icon: Boxes,
    label: 'VEC',
    unit: '集合',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    iconBg: 'bg-amber-50',
    iconText: 'text-amber-600',
  },
};

export interface KbCardProps {
  kb: KuItem;
  selected: boolean;
  /** 以图搜库命中分数(0-1);非空 → 玫粉边框 + badge */
  imageScore?: number | null;
  /** 入场动画的次序 */
  index?: number;
  onToggle(): void;
  onOpen(): void;
}

export const KbCard: React.FC<KbCardProps> = ({
  kb,
  selected,
  imageScore = null,
  index = 0,
  onToggle,
  onOpen,
}) => {
  const meta = KIND[kb.kind];
  const Icon = meta.icon;
  const isImageHit = imageScore != null && imageScore > 0;
  const visibility = kb.visibility ?? 'private';
  const delay = Math.min(index, 15) * 25;

  return (
    <KbDropZone
      kb={kb}
      hint="corner"
      canUpload={!!kb.mine}
      className={cn(
        'group relative flex h-44 flex-col overflow-hidden rounded-xl border bg-[var(--cy-surface-base)] text-left transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-[var(--cy-shadow-md)]',
        selected
          ? 'border-[var(--cy-brand-500)] shadow-[var(--cy-shadow-md)] ring-1 ring-[var(--cy-brand-300)]'
          : isImageHit
            ? 'border-rose-300 shadow-[0_0_0_2px_rgba(244,63,94,0.18)]'
            : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-300)]',
      )}
    >
      <div
        style={{ animation: `kbCardIn .35s ease-out ${delay}ms backwards` }}
        className="relative flex h-full w-full flex-col"
      >
        {/* 多选 checkbox(默认隐藏,hover 或选中可见) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={selected ? '取消选择' : '选择'}
          className={cn(
            'absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-white/95 backdrop-blur transition-opacity',
            selected
              ? 'border-[var(--cy-brand-600)] bg-[var(--cy-brand-600)] text-white opacity-100'
              : 'border-[var(--cy-border-default)] opacity-0 group-hover:opacity-100',
          )}
        >
          {selected && <CheckCheck className="h-3 w-3" />}
        </button>

        {/* 主体可点击 */}
        <button type="button" onClick={onOpen} className="flex h-full w-full flex-col px-4 pt-3.5 pb-3 text-left">
          {/* 第 1 行:粗标题(可选小图标前缀) */}
          <div className="flex items-start gap-2">
            <span
              className={cn(
                'mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md',
                meta.iconBg, meta.iconText,
              )}
              aria-hidden
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <p className="min-w-0 flex-1 truncate pr-6 text-sm font-medium text-[var(--cy-text-primary)]">
              {kb.display_name}
            </p>
          </div>

          {/* 第 2 行:描述 */}
          <p className="mt-2 line-clamp-3 flex-1 text-[12px] leading-relaxed text-[var(--cy-text-secondary)]">
            {kb.description || '—'}
          </p>

          {/* 第 3 行:chip + 元信息 */}
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--cy-text-tertiary)]">
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', meta.chipBg, meta.chipText)}>
              <Icon className="h-2.5 w-2.5" />
              {meta.label}
            </span>
            <span className="inline-flex items-center gap-2 opacity-80">
              {kb.count != null && (
                <span>
                  {kb.count} {meta.unit}
                </span>
              )}
              {visibility === 'private' && <Lock className="h-2.5 w-2.5" />}
              {kb.create_time && <span>{formatDate(kb.create_time)}</span>}
            </span>
          </div>
        </button>

        {/* mine pill 角标 */}
        {kb.mine && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-[var(--cy-brand-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--cy-brand-700)]">
            我的
          </span>
        )}

        {/* 以图搜库命中分数 badge */}
        {isImageHit && (
          <span className="pointer-events-none absolute right-2 bottom-2 z-10 inline-flex items-center gap-1 rounded-full bg-rose-500/95 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
            <span>{(imageScore * 100).toFixed(0)}</span>
            <span className="opacity-80">分</span>
          </span>
        )}

        {/* 上传进度条(下沿,只在有 jobs 时渲染) */}
        <KbProgressBar kuId={kb.ku_id} />
      </div>
    </KbDropZone>
  );
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}`;
}

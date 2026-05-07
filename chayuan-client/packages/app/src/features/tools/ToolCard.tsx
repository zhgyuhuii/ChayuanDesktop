/**
 * ToolCard —— 工具卡片(对齐 KbCard / McpCard 设计语言)。
 *
 * 三行:
 *   ① 工具图标 + name(粗,等宽小标签)+ 选中标
 *   ② title / description line-clamp-3
 *   ③ namespace chip(name 前缀 / category)+ 字段数 / 模型相关性
 *
 * 设计:
 *   - 卡片可"加入 / 移出 Composer 选中工具集"(selected → setTools)
 *   - 不删除/不创建(后端工具是 catalog,readonly)
 */

import * as React from 'react';
import { CheckCheck, Wrench } from 'lucide-react';
import { cn } from '@chayuan/ui';
import type { ToolInfo } from '@chayuan/api';

export interface ToolCardProps {
  tool: ToolInfo;
  selected: boolean;
  index?: number;
  onToggle(): void;
}

/** 由工具 name 推一个分类 chip,用于 UI 着色和分组提示 */
function deriveCategory(name: string): { label: string; tint: string } {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('search')) return { label: 'SEARCH', tint: 'bg-sky-50 text-sky-700' };
  if (lower.includes('weather')) return { label: 'WEATHER', tint: 'bg-amber-50 text-amber-700' };
  if (lower.includes('arxiv') || lower.includes('paper'))
    return { label: 'PAPER', tint: 'bg-emerald-50 text-emerald-700' };
  if (lower.includes('image') || lower.includes('vision'))
    return { label: 'IMAGE', tint: 'bg-rose-50 text-rose-700' };
  if (lower.includes('shell') || lower.includes('bash') || lower.includes('exec'))
    return { label: 'SHELL', tint: 'bg-violet-50 text-violet-700' };
  if (lower.includes('http') || lower.includes('fetch') || lower.includes('url'))
    return { label: 'HTTP', tint: 'bg-cyan-50 text-cyan-700' };
  if (lower.includes('sql') || lower.includes('db'))
    return { label: 'SQL', tint: 'bg-emerald-50 text-emerald-700' };
  return { label: 'TOOL', tint: 'bg-slate-100 text-slate-700' };
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool, selected, index = 0, onToggle }) => {
  const cat = deriveCategory(tool.name);
  const delay = Math.min(index, 15) * 25;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ animation: `mpCardIn .35s ease-out ${delay}ms backwards` }}
      className={cn(
        'group relative flex h-44 flex-col overflow-hidden rounded-xl border bg-[var(--cy-surface-base)] text-left transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-[var(--cy-shadow-md)]',
        selected
          ? 'border-[var(--cy-brand-500)] shadow-[var(--cy-shadow-md)] ring-1 ring-[var(--cy-brand-300)]'
          : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-300)]',
      )}
    >
      {/* 已选角标 */}
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--cy-brand-600)] text-white"
        >
          <CheckCheck className="h-3 w-3" />
        </span>
      )}

      <div className="flex h-full w-full flex-col px-4 pt-3.5 pb-3 text-left">
        {/* 第 1 行:icon + name */}
        <div className="flex items-start gap-2">
          <span className={cn('mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md', cat.tint)}>
            <Wrench className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate pr-7 font-mono text-[12px] font-medium text-[var(--cy-text-primary)]">
              {tool.name}
            </p>
            {tool.title && tool.title !== tool.name && (
              <p className="truncate text-[11px] text-[var(--cy-text-tertiary)]">{tool.title}</p>
            )}
          </div>
        </div>

        {/* 第 2 行:description */}
        <p className="mt-2 line-clamp-3 flex-1 text-[12px] leading-relaxed text-[var(--cy-text-secondary)]">
          {tool.description || '—'}
        </p>

        {/* 第 3 行:category chip */}
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--cy-text-tertiary)]">
          <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', cat.tint)}>
            {cat.label}
          </span>
          {tool.config && Object.keys(tool.config).length > 0 && (
            <span className="opacity-80">{Object.keys(tool.config).length} 配置</span>
          )}
        </div>
      </div>
    </button>
  );
};

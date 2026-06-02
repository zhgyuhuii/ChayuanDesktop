/**
 * 模型广场顶部过滤区。
 *
 * 控件:
 *   ① 源 tab(ModelScope / HuggingFace / 已安装);HuggingFace 选中时旁边出
 *      线路 <select>(hf-mirror 国内 / 官方)。
 *   ② 能力类型 chips(GalleryCapabilityChips,含「全部」)。
 *   ③ 搜索框(防抖在 ModelGalleryPage 持有,这里仅受控回调)。
 *   ④ 「仅可运行」开关。
 *
 * 「已安装」tab 下隐藏「线路 / 仅可运行」等远程检索专属控件。
 */

import { cn } from '@chayuan/ui';
import { Search } from 'lucide-react';
import * as React from 'react';
import { GalleryCapabilityChips } from './GalleryCapabilityChips';
import type { GallerySort, GallerySource, HfRoute } from './ModelGalleryPage';

const SOURCE_TABS: ReadonlyArray<{ value: GallerySource; label: string }> = [
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'huggingface', label: 'HuggingFace' },
  { value: 'installed', label: '已安装' },
];

export interface GalleryFiltersProps {
  source: GallerySource;
  onSourceChange(s: GallerySource): void;
  hfRoute: HfRoute;
  onHfRouteChange(r: HfRoute): void;
  /** 搜索框文本(受控);防抖在父级 */
  queryInput: string;
  onQueryInputChange(v: string): void;
  capability: string | null;
  onCapabilityChange(c: string | null): void;
  runnableOnly: boolean;
  onRunnableOnlyChange(v: boolean): void;
  /** 排序:下载量 / 最近更新。 */
  sort: GallerySort;
  onSortChange(s: GallerySort): void;
  /** HuggingFace 源端可选 token(私有仓 / 限流);仅 HF tab 显示。 */
  hfToken: string;
  onHfTokenChange(v: string): void;
}

export const GalleryFilters: React.FC<GalleryFiltersProps> = ({
  source,
  onSourceChange,
  hfRoute,
  onHfRouteChange,
  queryInput,
  onQueryInputChange,
  capability,
  onCapabilityChange,
  runnableOnly,
  onRunnableOnlyChange,
  sort,
  onSortChange,
  hfToken,
  onHfTokenChange,
}) => {
  const isInstalled = source === 'installed';
  const isHf = source === 'huggingface';

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--cy-border-subtle)] pb-3">
      {/* 源 tab + 线路 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-full bg-[var(--cy-surface-1)] p-0.5">
          {SOURCE_TABS.map((tab) => {
            const active = source === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onSourceChange(tab.value)}
                aria-pressed={active}
                className={cn(
                  'h-7 rounded-full px-3 text-xs font-medium transition-colors',
                  active
                    ? 'bg-[var(--cy-surface-base)] text-[var(--cy-text-primary)] shadow-sm'
                    : 'text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {isHf && (
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--cy-text-secondary)]">
            线路
            <select
              value={hfRoute}
              onChange={(e) => onHfRouteChange(e.target.value as HfRoute)}
              className="h-7 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
            >
              <option value="mirror">hf-mirror(国内)</option>
              <option value="official">官方</option>
            </select>
          </label>
        )}

        {isHf && (
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--cy-text-secondary)]">
            HF Token
            <input
              type="password"
              value={hfToken}
              onChange={(e) => onHfTokenChange(e.target.value)}
              placeholder="可选(私有仓 / 限流)"
              autoComplete="off"
              className="h-7 w-[180px] rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
            />
          </label>
        )}
      </div>

      {/* 能力 chips */}
      <GalleryCapabilityChips value={capability} onChange={onCapabilityChange} />

      {/* 搜索框 + 仅可运行 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cy-text-tertiary)]" />
          <input
            value={queryInput}
            onChange={(e) => onQueryInputChange(e.target.value)}
            placeholder={isInstalled ? '搜索已安装模型' : '搜索模型 / owner'}
            className="h-8 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] pl-8 pr-2 text-xs text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
          />
        </div>

        {!isInstalled && (
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--cy-text-secondary)]">
            排序
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as GallerySort)}
              title={
                source === 'modelscope'
                  ? 'ModelScope 仅支持按当前页本地排序最近更新;按下载量为源端默认顺序'
                  : undefined
              }
              className="h-7 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
            >
              <option value="downloads">下载量</option>
              <option value="updated">最近更新</option>
            </select>
          </label>
        )}

        {!isInstalled && (
          <button
            type="button"
            role="switch"
            aria-checked={runnableOnly}
            onClick={() => onRunnableOnlyChange(!runnableOnly)}
            className="inline-flex items-center gap-2 text-xs text-[var(--cy-text-secondary)]"
          >
            <span
              className={cn(
                'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                runnableOnly ? 'bg-[var(--cy-brand-500)]' : 'bg-[var(--cy-surface-3)]',
              )}
            >
              <span
                className={cn(
                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                  runnableOnly ? 'translate-x-3.5' : 'translate-x-0.5',
                )}
              />
            </span>
            仅可运行
          </button>
        )}
      </div>
    </div>
  );
};

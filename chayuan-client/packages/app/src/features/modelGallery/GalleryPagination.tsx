/**
 * 模型广场底部分页。
 *
 * 后端 model-hub search 走「游标式 has_more」分页,只能上一页 / 下一页 + 显示当前页码,
 * 不保证 total → 不渲染总页数。可选跳页输入(onJump 提供时显示)。
 */

import { cn } from '@chayuan/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

export interface GalleryPaginationProps {
  page: number;
  hasMore: boolean;
  onPrev(): void;
  onNext(): void;
  /** 提供时显示跳页输入框 */
  onJump?(page: number): void;
}

const BTN =
  'inline-flex h-8 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 text-xs text-[var(--cy-text-secondary)] transition-colors hover:bg-[var(--cy-surface-2)] disabled:cursor-not-allowed disabled:opacity-40';

export const GalleryPagination: React.FC<GalleryPaginationProps> = ({
  page,
  hasMore,
  onPrev,
  onNext,
  onJump,
}) => {
  const [jumpVal, setJumpVal] = React.useState('');

  const doJump = () => {
    const n = Number.parseInt(jumpVal, 10);
    if (Number.isFinite(n) && n >= 1 && onJump) {
      onJump(n);
      setJumpVal('');
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button type="button" onClick={onPrev} disabled={page <= 1} className={BTN}>
        <ChevronLeft className="h-3.5 w-3.5" />
        上一页
      </button>
      <span className="px-2 text-xs text-[var(--cy-text-secondary)]">第 {page} 页</span>
      <button type="button" onClick={onNext} disabled={!hasMore} className={cn(BTN)}>
        下一页
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {onJump && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">
          跳至
          <input
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doJump();
            }}
            inputMode="numeric"
            className="h-8 w-12 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-center text-xs text-[var(--cy-text-primary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
          />
          页
        </span>
      )}
    </div>
  );
};

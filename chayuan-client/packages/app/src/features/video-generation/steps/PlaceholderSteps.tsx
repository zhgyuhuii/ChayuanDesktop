/**
 * Step 3-7 简单占位 — M5.A3 仅保证 wizard 切换流程可见,具体功能 B 系列接入。
 */
import * as React from 'react';

interface PlaceholderProps {
  title: string;
  hint: string;
  todoMs: string;
}

const Placeholder: React.FC<PlaceholderProps> = ({ title, hint, todoMs }) => (
  <div className="rounded-2xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-6 text-center">
    <h3 className="text-base font-semibold text-[var(--cy-text-primary)]">{title}</h3>
    <p className="mt-2 text-sm text-[var(--cy-text-secondary)]">{hint}</p>
    <p className="mt-3 inline-block rounded-full bg-amber-50 px-3 py-0.5 text-[10px] text-amber-700">
      留待 {todoMs} 实现
    </p>
  </div>
);

/** Step 6/7 已经迁出本文件,所有 step 都进入真实组件。
 *  保留 Placeholder 组件以防后续 step 临时占位用。 */

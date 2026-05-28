/**
 * 全自动模式 ⚡ toggle。本地 state(VgChatPage 持有)— 不入 vgComposer.params。
 * 开:VgChatPage 收到主题后跳过脚本预览,直接 submitTask 一气呵成跑完。
 * 关:默认流程,生成脚本 → 用户编辑 → 点"去生成"才提交。
 */
import * as React from 'react';
import { Zap } from 'lucide-react';

export interface VgAutoToggleProps {
  autoMode: boolean;
  onChange: (v: boolean) => void;
}

export const VgAutoToggle: React.FC<VgAutoToggleProps> = ({ autoMode, onChange }) => (
  <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 text-xs">
    <input
      type="checkbox"
      checked={autoMode}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only"
    />
    <Zap className={'h-3 w-3 ' + (autoMode ? 'text-amber-500' : 'text-[var(--cy-text-tertiary)]')} />
    <span className={autoMode ? 'text-amber-700 font-medium' : 'text-[var(--cy-text-secondary)]'}>
      {autoMode ? '全自动' : '自动'}
    </span>
  </label>
);

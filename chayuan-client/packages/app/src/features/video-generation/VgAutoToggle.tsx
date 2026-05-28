/**
 * 全自动模式横幅 — 紧贴 ChatComposer 上方,样式比 toolbar chip 醒目得多。
 *
 * 关:默认流程 — 生成脚本 → 用户审 → 点"去生成"才提交
 * 开:输入主题即直接 submitTask 一气呵成跑完(跳过脚本预览)
 */
import * as React from 'react';
import { Zap } from 'lucide-react';

export interface VgAutoBannerProps {
  autoMode: boolean;
  onChange: (v: boolean) => void;
}

export const VgAutoBanner: React.FC<VgAutoBannerProps> = ({ autoMode, onChange }) => (
  <label
    className={
      'flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs transition-colors ' +
      (autoMode
        ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-900'
        : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-[var(--cy-text-secondary)]')
    }
  >
    <span className="inline-flex items-center gap-2">
      <Zap className={'h-4 w-4 ' + (autoMode ? 'fill-amber-400 text-amber-500' : 'text-[var(--cy-text-tertiary)]')} />
      <span className={autoMode ? 'font-semibold' : 'font-medium'}>
        {autoMode ? '全自动模式 · 已开启' : '全自动模式'}
      </span>
      <span className="text-[10px] text-[var(--cy-text-tertiary)]">
        {autoMode
          ? '输入主题即直接生成视频,跳过脚本预览'
          : '关闭时:生成脚本 → 你审阅 → 点"去生成"才提交'}
      </span>
    </span>
    <span className="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={autoMode}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={
          'relative inline-block h-4 w-7 rounded-full transition-colors ' +
          (autoMode ? 'bg-amber-500' : 'bg-[var(--cy-surface-3,#cbd5e1)]')
        }
      >
        <span
          className={
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ' +
            (autoMode ? 'left-3.5' : 'left-0.5')
          }
        />
      </span>
    </span>
  </label>
);

/** 旧名兼容(R3.2 时建的旧组件 export name);新代码请用 VgAutoBanner */
export const VgAutoToggle = VgAutoBanner;

/**
 * 首页底部走马灯 — 版权 + slogan 横向无限循环,点击弹"关注我们"二维码 dialog。
 *
 * 复用 FeedbackDialog(二维码源已在 brandAssets.FOLLOW_QR_URL,不重复配置)。
 *
 * 行为:
 *   - 文案: 版权一段 + slogan 一段,中间用 · 分隔; 重复两遍拼接成 marquee track,
 *     CSS animation 持续左移,首末无缝衔接(translateX -50% 复位)
 *   - 鼠标 hover 暂停滚动
 *   - 点击整条触发 FeedbackDialog
 *   - prefers-reduced-motion 用户尊重(motion-reduce 静止显示前半段)
 */

import * as React from 'react';
import { FeedbackDialog } from '../help/FeedbackDialog';

const MARQUEE_ITEMS = [
  '© 2026 北京智灵鸟科技中心',
  '源码授权 · 商业合作请联系我们',
  '察元 AI 助手 · 让办公场景里每个人都能用上 AI',
];

// 把同一份 items 重复两遍,做无缝循环
const TRACK_ITEMS = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

export const HomeFooterMarquee: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-label="点击关注我们 — 公众号二维码"
        className="
          group relative z-10 cursor-pointer overflow-hidden rounded-full
          border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]
          px-4 py-2 text-xs text-[var(--cy-text-tertiary)]
          hover:text-[var(--cy-text-primary)] hover:border-[var(--cy-accent)]
          transition-colors
        "
      >
        <div
          className="
            flex w-max items-center gap-8 whitespace-nowrap
            motion-safe:animate-[chayuan-marquee_28s_linear_infinite]
            group-hover:[animation-play-state:paused]
          "
        >
          {TRACK_ITEMS.map((text, i) => (
            <span key={i} className="inline-flex items-center gap-8">
              <span>{text}</span>
              <span aria-hidden className="text-[var(--cy-text-quaternary)]">·</span>
            </span>
          ))}
        </div>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] opacity-60 group-hover:opacity-100">
          关注我们 →
        </span>
      </div>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

/**
 * 主页"按模型类型开始对话"网格 — 主页直接放这一个组件即可。
 *
 * 职责:
 *   1. 拉一次 ``useAvailableModelsByCapability`` 共享缓存
 *   2. 按 ``HOME_CAPABILITY_CARDS`` 顺序渲染每张 ``CapabilityCard``
 *   3. 卡片 onActivate / onShowHelp 都用 ``useCallback`` 稳定,避免 memo 失效
 *   4. ``loading`` 时铺骨架,首屏不闪
 *   5. "已配模型 + 未配模型"混排可读:section header 显示"已接入 X 类 / 共 7 类"
 *
 * 帮助 dialog 是一个 controlled Dialog,通过 ``initialCap`` 锚定 scroll;
 * 同一时刻只有一个,避免重复 mount 浪费。
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Settings2, Layers3 } from 'lucide-react';
import type { ModalityCapability } from '@chayuan/transport';
import { CapabilityCard } from './CapabilityCard';
import { HOME_CAPABILITY_CARDS } from './capabilityCardCatalog';
import {
  pickBestModel,
  useAvailableModelsByCapability,
} from './useAvailableModelsByCapability';
import { startCapabilityChat } from './startCapabilityChat';
import {
  ModelSupportHelpButton,
  ModelSupportHelpDialog,
} from '../../composer/ModelSupportHelpDialog';


export interface CapabilityCardGridProps {
  /** 没任何配置时,主页可能把卡片整片隐藏走另一条 onboarding;不传默认始终显示 */
  hideWhenAllEmpty?: boolean;
  /** 传入则在本组末尾追加一张「模型厂商」卡(点击 → 此回调)。 */
  onMarketplace?: () => void;
  /** 'cards'(默认大卡)/ 'chips'(主页紧凑一行小按钮) */
  variant?: 'cards' | 'chips';
}

// chips 变体的能力小图标(spec 无 icon 字段,按 cap 映射;缺省无 emoji)
const CAP_EMOJI: Record<string, string> = {
  chat: '💬', vl: '👁', t2i: '🎨', image_edit: '🖼', t2v: '🎬', i2v: '🎥', tts: '🔊', asr: '🎙',
};


export const CapabilityCardGrid: React.FC<CapabilityCardGridProps> = ({
  hideWhenAllEmpty = false,
  onMarketplace,
  variant = 'cards',
}) => {
  const navigate = useNavigate();
  const { byCap, hasAny, isLoading, isFetched } = useAvailableModelsByCapability();
  // 帮助 dialog 锚跳 — 未配卡 onShowHelp 时把它打开并自动滚到对应 cap 段
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [helpAnchor, setHelpAnchor] = React.useState<ModalityCapability | undefined>(undefined);

  // 稳定回调:模型列表变 / nav 变才重建,React.memo 才有效
  const onActivate = React.useCallback(
    (cap: ModalityCapability) => {
      // 全部能力(含文生视频 t2v)统一走对话页 composer:用户在对话框里直接
      // 文生/图生视频(选 kling/wanx 等模型即可)。独立"视频生成"工作区(时间轴
      // NLE)是另一条入口,不再从首页能力卡进入。
      const best = pickBestModel(byCap.get(cap));
      if (!best) return; // 防御:卡片本来该禁用,但极端竞争下兜一手
      startCapabilityChat(
        { cap, model: best },
        { navigate: (to) => void navigate({ to: to as never }) },
      );
    },
    [byCap, navigate],
  );

  const onShowHelp = React.useCallback((cap: ModalityCapability) => {
    setHelpAnchor(cap);
    setHelpOpen(true);
  }, []);

  if (hideWhenAllEmpty && isFetched && !hasAny) return null;

  // ── chips 变体:主页紧凑一行小按钮(复用上面全部逻辑)──────────────
  if (variant === 'chips') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">开始对话</h2>
          <span className="hidden text-[11px] text-[var(--cy-text-tertiary)] sm:inline">选一类能力直接开新对话,自动选可用模型</span>
          <span className="ml-auto"><ModelSupportHelpButton /></span>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLoading && !isFetched
            ? Array.from({ length: HOME_CAPABILITY_CARDS.length }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架固定数量
                <div key={`chip-skel-${i}`} className="h-8 w-20 animate-pulse rounded-full bg-[var(--cy-surface-base)]" />
              ))
            : HOME_CAPABILITY_CARDS.map((spec) => {
                const ok = (byCap.get(spec.cap)?.length ?? 0) > 0;
                return (
                  <button
                    key={spec.cap}
                    type="button"
                    onClick={() => (ok ? onActivate(spec.cap) : onShowHelp(spec.cap))}
                    title={ok ? spec.subtitle : spec.empty_hint}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${ok
                      ? 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-[var(--cy-text-primary)] hover:border-[var(--cy-brand-400)] hover:bg-[var(--cy-brand-50)]'
                      : 'border-dashed border-[var(--cy-border-subtle)] bg-transparent text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]'}`}
                  >
                    <span aria-hidden>{CAP_EMOJI[spec.cap] ?? '✨'}</span>
                    {spec.title}
                    {!ok && <span className="ml-0.5 text-[10px] opacity-70">未配</span>}
                  </button>
                );
              })}
          {onMarketplace && (
            <button type="button" onClick={onMarketplace}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 text-xs font-medium text-[var(--cy-text-secondary)] hover:border-[var(--cy-brand-400)]">
              <Layers3 className="h-3.5 w-3.5" /> 模型厂商
            </button>
          )}
        </div>
        <ModelSupportHelpDialog open={helpOpen} onOpenChange={setHelpOpen} initialCap={helpAnchor} />
      </div>
    );
  }

  return (
    <section
      // 背景半透明 — 让底部金龙 / 星空动画透出来,不被整块挡住;再用边框 +
      // 极淡底色把 7 张卡片框成一个可辨识的「分组」。卡片自身不透明,内容清晰。
      className="rounded-3xl border border-[var(--cy-border-default)] p-5"
      style={{
        background: 'color-mix(in srgb, var(--cy-surface-1) 26%, transparent)',
      }}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">按模型类型开始对话</h2>
          <p className="text-xs text-[var(--cy-text-tertiary)]">
            选一类能力直接开新对话,系统自动挑可用模型并切换好输入框的模式
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* "如何配置"入口 — 跟卡片"未配置"按钮共用同一个帮助面板 */}
          <span
            className="hidden text-[11px] text-[var(--cy-text-tertiary)] sm:inline-flex items-center gap-1"
            title="该选择器跟 ChatComposer 顶部 ✨ 模式 badge 同一套色"
          >
            <Settings2 className="h-3 w-3" /> 通用调色板
          </span>
          <ModelSupportHelpButton />
        </div>
      </header>

      {/* 7 张能力卡(+末尾可选「模型厂商」)。窄屏 2、lg 4、2xl 起 8(单行)。 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        {isLoading && !isFetched ? (
          // 骨架 — 不阻塞首屏,等 react-query 跑完自动替换
          Array.from({ length: HOME_CAPABILITY_CARDS.length }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架卡固定数量,顺序稳定
              key={`skel-${i}`}
              className="h-36 2xl:h-32 animate-pulse rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
            />
          ))
        ) : (
          HOME_CAPABILITY_CARDS.map((spec) => {
            const count = byCap.get(spec.cap)?.length ?? 0;
            return (
              <CapabilityCard
                key={spec.cap}
                spec={spec}
                modelCount={count}
                onActivate={onActivate}
                onShowHelp={onShowHelp}
              />
            );
          })
        )}
        {/* 末尾追加:模型厂商(放在"按模型类型开始对话"这一组最后一个) */}
        {onMarketplace && (
          <button
            type="button"
            onClick={onMarketplace}
            className="flex h-36 2xl:h-32 flex-col items-start justify-between rounded-2xl border border-[var(--cy-border-subtle)] bg-gradient-to-br from-violet-50 to-fuchsia-100 p-3 text-left transition-colors hover:border-[var(--cy-brand-400)] dark:from-violet-900/30 dark:to-fuchsia-800/40"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 text-white">
              <Layers3 className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-[var(--cy-text-primary)]">模型厂商</span>
              <span className="block text-[11px] text-[var(--cy-text-tertiary)]">云端 / 本地 / 聚合厂商一键接入</span>
            </span>
          </button>
        )}
      </div>

      {/* 主页未配置卡触发的"如何接入"帮助 — initialCap 自动滚到对应 cap 段 */}
      <ModelSupportHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        initialCap={helpAnchor}
      />
    </section>
  );
};

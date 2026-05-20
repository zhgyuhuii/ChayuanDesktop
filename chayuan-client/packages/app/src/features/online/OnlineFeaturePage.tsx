/**
 * OnlineFeaturePage —— 在线办公功能占位页(单机版)。
 *
 * 「察元 AI 桌面单机版」是免费的本地离线版本,不包含「在线办公」相关能力。
 * 侧边栏里的察元办公 / 智能空间 / 应用中心 / 我的待办 / 训练数据中心点开后都
 * 进入本页,按 ``featureKey`` 参数化展示对应功能的介绍。
 *
 * 行为:
 *   1. 流式打字机:对 onlineFeatures.ts 里**预先写好的静态文案**做逐字渲染。
 *      不调用任何 LLM —— 单机版要求完全离线可用,且文案是固定的。打字机用
 *      rAF 分块推进(参考首页 HomePage 的 rAF 合批思路)。
 *   2. 文案流完后:
 *      - 普通功能:直接展示「当前为免费单机版」说明 + 联系商务区。
 *      - 配了 rich 的功能(目前仅「我的待办」):先渲染多个功能板块
 *        (小标题 + 说明 + SVG 示意截图),再展示单机版说明 + 联系商务区。
 *
 * 联系方式复用 PartnershipBanner 的常量。视觉跟随主题,只用 var(--cy-*),
 * 不硬编码颜色。
 */

import * as React from 'react';
import {
  Sparkles,
  Lock,
  Mail,
  MessageSquare,
  Copy,
  Check,
  Workflow,
  MessagesSquare,
  LayoutGrid,
  Clock,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { FOLLOW_QR_URL } from '../../lib/brandAssets';
import { notifySuccess } from '../../store/errorDialog';
import {
  findOnlineFeature,
  type OnlineFeature,
  type RichSection,
} from './onlineFeatures';
import {
  TasklistViewsMock,
  ConversationalFormMock,
  FlowHandoffMock,
} from './TasklistMockups';

// 联系方式真源:与 PartnershipBanner 保持一致,不另写一套。
const CONTACT_EMAIL = 'cmdbird@163.com';
const CONTACT_WECHAT = '智灵鸟科技';

/** 每帧推进的字符数 —— 偏小让逐字效果明显,但整体不拖沓。 */
const CHARS_PER_TICK = 2;

export interface OnlineFeaturePageProps {
  /** 路由参数:onlineFeatures.ts 里的 feature key */
  featureKey: string;
}

export const OnlineFeaturePage: React.FC<OnlineFeaturePageProps> = ({ featureKey }) => {
  const feature = findOnlineFeature(featureKey);
  if (!feature) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--cy-surface-base)] text-sm text-[var(--cy-text-tertiary)]">
        未知的在线功能:{featureKey}
      </div>
    );
  }
  return <OnlineFeatureBody key={feature.key} feature={feature} />;
};

const OnlineFeatureBody: React.FC<{ feature: OnlineFeature }> = ({ feature }) => {
  const rich = feature.rich;
  // 富版只把 paragraphs 用打字机流式输出,单机版说明挪到富版板块之后的卡片里;
  // 普通版仍把功能介绍 + 单机版说明拼成一段一起打字。段落间用 \n\n 分隔。
  const fullText = React.useMemo(() => {
    if (rich) return feature.paragraphs.join('\n\n');
    const upsell =
      '说明:你当前使用的是「察元 AI 桌面单机版」—— 一个免费、本地离线运行的版本。' +
      '上面介绍的「在线办公」能力需要服务端协同,单机版暂不支持。' +
      '如果你的团队需要这些在线能力,欢迎通过下方方式联系我们获取在线版 / 私有化部署方案。';
    return [...feature.paragraphs, upsell].join('\n\n');
  }, [feature.paragraphs, rich]);

  // 流式打字机:rAF 分块推进 typed 长度。done 后展示联系商务区。
  const [typedLen, setTypedLen] = React.useState(0);
  const [done, setDone] = React.useState(false);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setTypedLen(0);
    setDone(false);
    let len = 0;
    const tick = () => {
      len = Math.min(fullText.length, len + CHARS_PER_TICK);
      setTypedLen(len);
      if (len >= fullText.length) {
        setDone(true);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [fullText]);

  const typed = fullText.slice(0, typedLen);
  // 切回完整段落数组渲染,保留段间留白。
  const paragraphs = typed.split('\n\n');

  return (
    <div className="h-full overflow-auto bg-[var(--cy-surface-base)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        {/* 标题区 */}
        <header className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--cy-text-primary)]">
                {feature.title}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 py-0.5 text-[11px] font-medium text-[var(--cy-text-tertiary)]">
                <Lock className="h-3 w-3" />
                在线功能
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--cy-text-secondary)]">{feature.tagline}</p>
          </div>
        </header>

        {/* 流式介绍正文 */}
        <article className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5 text-sm leading-relaxed text-[var(--cy-text-primary)]">
          {paragraphs.map((para, i) => {
            const isLast = i === paragraphs.length - 1;
            return (
              <p key={i} className={i > 0 ? 'mt-3' : undefined}>
                {para}
                {!done && isLast && <Caret />}
              </p>
            );
          })}
        </article>

        {/* 深度介绍板块 —— 仅 rich 功能(我的待办),文案流完后再出现 */}
        {done && rich
          ? rich.sections.map((section, i) => (
              <RichSectionBlock key={section.heading} section={section} index={i} />
            ))
          : null}

        {/* 单机版说明 —— rich 功能把它单独成卡(普通版已拼进打字文案里) */}
        {done && rich ? (
          <section className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--cy-surface-2)] text-[var(--cy-text-tertiary)]">
                <Lock className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">
                  当前为免费单机版,暂不支持在线办公
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--cy-text-secondary)]">
                  你正在使用「察元 AI 桌面单机版」—— 一个免费、本地离线运行的版本。上面介绍的
                  「我的待办」依赖服务端的流程引擎、人工节点挂起与通知协同,单机版暂不支持。
                  如果你的团队需要人机协同流程能力,欢迎通过下方方式联系我们获取在线版 /
                  私有化部署方案。
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* 联系商务区 —— 文案流完后再出现 */}
        {done && (
          <section className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--cy-text-tertiary)]">
                联系商务
              </span>
            </div>
            <h2 className="text-base font-semibold text-[var(--cy-text-primary)]">
              想用上「{feature.title}」?
            </h2>
            <p className="mt-1 text-sm text-[var(--cy-text-secondary)]">
              欢迎咨询察元 AI 在线版、私有化部署与行业定制方案。
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {/* 邮箱 */}
              <div className="flex items-center gap-3 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] text-white shadow-sm">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[var(--cy-text-tertiary)]">商务邮箱</p>
                  <p className="truncate font-mono text-sm font-semibold text-[var(--cy-text-primary)]">
                    {CONTACT_EMAIL}
                  </p>
                </div>
                <CopyButton value={CONTACT_EMAIL} label="邮箱" />
              </div>

              {/* 微信公众号 */}
              <div className="flex items-center gap-3 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] text-white shadow-sm">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[var(--cy-text-tertiary)]">微信公众号</p>
                  <p className="truncate text-sm font-semibold text-[var(--cy-text-primary)]">
                    {CONTACT_WECHAT}
                  </p>
                  <p className="text-[11px] text-[var(--cy-text-tertiary)]">
                    扫右侧二维码关注,私信「在线办公」接洽
                  </p>
                </div>
              </div>
            </div>

            {/* 关注二维码 */}
            <div className="mt-3 flex items-center gap-4 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4">
              <img
                src={FOLLOW_QR_URL}
                alt="智灵鸟科技公众号二维码"
                className="h-28 w-28 shrink-0 rounded-md border border-[var(--cy-border-subtle)] bg-white object-contain p-1"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--cy-text-primary)]">
                  关注「{CONTACT_WECHAT}」公众号
                </p>
                <p className="mt-1 text-xs text-[var(--cy-text-secondary)]">
                  获取察元 AI 在线版试用、私有化部署与渠道合作的最新信息。
                </p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

// ── 深度介绍板块 ───────────────────────────────────────────────────

/** rich section 的 icon 名 → lucide 组件。未知名兜底用 ClipboardList。 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  workflow: Workflow,
  'messages-square': MessagesSquare,
  'layout-grid': LayoutGrid,
  clock: Clock,
};

/** mockup id → 示意截图组件。 */
const MOCKUPS: Record<NonNullable<RichSection['mockup']>, React.FC> = {
  views: TasklistViewsMock,
  'conversational-form': ConversationalFormMock,
  'flow-handoff': FlowHandoffMock,
};

/**
 * 单个功能板块:左侧小标题 + 说明 + 要点;右侧 SVG 示意截图。
 * 偶数 / 奇数板块左右交错排版,长页面读起来不单调;窄屏自动堆叠为单列。
 */
const RichSectionBlock: React.FC<{ section: RichSection; index: number }> = ({
  section,
  index,
}) => {
  const Icon = SECTION_ICONS[section.icon] ?? ClipboardList;
  const Mockup = section.mockup ? MOCKUPS[section.mockup] : null;
  // 有配图才交错;无配图(如「截止置顶」)就单列铺满。
  const reversed = Mockup != null && index % 2 === 1;

  return (
    <section className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-5">
      <div
        className={
          Mockup
            ? `flex flex-col gap-5 md:items-center ${
                reversed ? 'md:flex-row-reverse' : 'md:flex-row'
              }`
            : 'flex flex-col gap-3'
        }
      >
        {/* 文字区 */}
        <div className={Mockup ? 'min-w-0 flex-1' : 'min-w-0'}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] text-white shadow-sm">
              <Icon className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold text-[var(--cy-text-primary)]">
              {section.heading}
            </h2>
          </div>

          {section.body.map((para, i) => (
            <p
              key={i}
              className={`text-sm leading-relaxed text-[var(--cy-text-secondary)] ${
                i === 0 ? 'mt-3' : 'mt-2'
              }`}
            >
              {para}
            </p>
          ))}

          {section.highlights && section.highlights.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {section.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 text-[13px] text-[var(--cy-text-primary)]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--cy-brand-500)]" />
                  <span className="leading-snug">{h}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* 示意截图区 */}
        {Mockup ? (
          <figure className="min-w-0 shrink-0 md:w-[46%]">
            <div className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-2)] p-2 shadow-sm">
              <Mockup />
            </div>
            <figcaption className="mt-1.5 text-center text-[11px] text-[var(--cy-text-tertiary)]">
              界面示意图(在线版实际效果)
            </figcaption>
          </figure>
        ) : null}
      </div>
    </section>
  );
};

// ── 打字机光标 —— 仅流式过程中跟在文末;复用首页 Caret 思路,
//    用户系统勾了「减少动画」时变成静态竖线,不会一直闪。 ──────────
const Caret: React.FC = () => (
  <span
    aria-hidden
    className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-[var(--cy-text-tertiary)] align-text-bottom motion-safe:animate-pulse"
  />
);

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = React.useState(false);
  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      notifySuccess(`已复制 ${label}:${value}`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 老 webview 不支持 clipboard API — fallback execCommand
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        notifySuccess(`已复制 ${label}`);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
  }, [value, label]);

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--cy-text-secondary)] transition-colors hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          已复制
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          复制
        </>
      )}
    </button>
  );
};

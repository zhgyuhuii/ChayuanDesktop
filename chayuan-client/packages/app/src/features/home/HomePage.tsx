/**
 * HomePage — 主页(单机版重构 2026-05-09):
 *
 *   1. Greeting(早/午/晚 + 用户名)+ 流式产品介绍气泡(进首页跑一次,流完即静止)
 *   2. [可选 banner] 还没配模型 → 跳模型广场
 *   3. 4 张炫酷功能入口卡(知识库 / 模型广场 / MCP 服务 / 工具中心)— 4 列等宽
 *   4. 关注我们 + 收款码 三张二维码
 *   5. 特性 chip + WPS 加载项 / GitHub / 官网链接
 *
 * 历史:
 *  - 2026-05-09 移除旧版 Composer + 占位能力,首页改为产品入口 + 介绍。
 *  - 2026-05-12 取消"每 4s 自动换文案"循环 — LLM 不可用时它会在静态文案
 *    间反复切,视觉上就是"屏幕闪烁"。改为单次播放 + rAF 合批 chunk 渲染,
 *    气泡固定 min-h 避免内容增长推开下方卡片。
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Library, Layers3, Plug, Wrench, Pen,
  AlertCircle, ExternalLink, Github, Globe,
} from 'lucide-react';
import { home, type ProviderCatalogEntry } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { useAuthStore } from '../../store/auth';
import { useTabsStore } from '../../store/tabs';
import { useTranslation } from '../../i18n';
import { usePlatformCatalogQuery } from '../../store/modelPlatform';
import {
  ALIPAY_QR_URL, CHAYUAN_LOGO_URL, FOLLOW_QR_URL, WXPAY_QR_URL,
} from '../../lib/brandAssets';

// ── 5 张功能入口卡定义 ──────────────────────────────────────────────
interface CapItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  to: string;
  /** 卡片渐变 — 视觉系列从冷到暖排序,不同卡有"专属色" */
  gradient: string;
  iconBg: string;
}

const CAPS: ReadonlyArray<CapItem> = [
  {
    id: 'kb',
    icon: Library,
    title: '知识库',
    subtitle: '文档 / 结构化 / 向量统一查询',
    to: '/kb',
    gradient: 'from-emerald-50 to-teal-100 dark:from-emerald-900/30 dark:to-teal-800/40',
    iconBg: 'bg-gradient-to-br from-emerald-400 to-teal-500',
  },
  {
    id: 'marketplace',
    icon: Layers3,
    title: '模型广场',
    subtitle: '云端 / 本地 / 聚合厂商一键接入',
    to: '/marketplace',
    gradient: 'from-violet-50 to-fuchsia-100 dark:from-violet-900/30 dark:to-fuchsia-800/40',
    iconBg: 'bg-gradient-to-br from-violet-400 to-fuchsia-500',
  },
  {
    id: 'mcp',
    icon: Plug,
    title: 'MCP 服务',
    subtitle: '接入 stdio / sse 工具协议',
    to: '/mcp',
    gradient: 'from-amber-50 to-orange-100 dark:from-amber-900/30 dark:to-orange-800/40',
    iconBg: 'bg-gradient-to-br from-amber-400 to-orange-500',
  },
  {
    id: 'tools',
    icon: Wrench,
    title: '工具中心',
    subtitle: '内置常用 agent 工具,可启停',
    to: '/tools',
    gradient: 'from-rose-50 to-pink-100 dark:from-rose-900/30 dark:to-pink-800/40',
    iconBg: 'bg-gradient-to-br from-rose-400 to-pink-500',
  },
  {
    id: 'notes',
    icon: Pen,
    title: 'AI 笔记',
    subtitle: '随手记录 · 实时语音转文字 · 自动入库可检索',
    to: '/notes/new',
    gradient: 'from-sky-50 to-cyan-100 dark:from-sky-900/30 dark:to-cyan-800/40',
    iconBg: 'bg-gradient-to-br from-sky-400 to-cyan-500',
  },
];

// ── 产品特性 chip ─────────────────────────────────────────────────
const FEATURES: ReadonlyArray<string> = [
  '多模型对话 ',
  '模型对抗',
  '本地知识库',
  '离线运行 · 数据不出本机',
  '兼容国产操作系统',
  'WPS AI 助手联动',
  'OpenAI / Ollama / Infinity / vLLM',
];

// ── 静态介绍文案 fallback(LLM 不可用时随机一段)────────────────────
const STATIC_INTROS: ReadonlyArray<string> = [
  '察元 AI · 单机版,把多模型对话、本地知识库、离线推理装进同一个桌面应用。装完即用,数据全程留在本机;Ollama / Infinity / vLLM 等本地服务跟云端 LLM 一起摆在桌面上,随时切换、对比试用。',
  '一个面向办公场景的本地 AI 工作台。支持多模型并排对话、文档 / 结构化数据 / 向量库统一检索;不联网也能跑,跟 WPS 加载项「察元 AI 文档助手」共用同一份知识库,文档操作直接在 Office 内完成。',
  '为离线 / 内网场景设计:多 LLM 永道对比、按需切到本地 Ollama / Infinity / vLLM,知识库文件、向量索引、对话历史全部存本机 SQLite,不上传任何 SaaS。可在统信 UOS / 麒麟 / openKylin 等国产桌面顺畅运行。',
  '把"装完一个 AI 应用"做到极致:零配置启动,Web / Tauri 桌面 / WPS 加载项 三端共用同一份知识库与对话状态。云模型与本地推理可随时切换,不强制联网,不强制登录。',
  '面向办公的本地优先 AI 助手。多 LLM 同屏对比、知识库一站式检索、MCP 工具集中托管。WPS 加载项「察元 AI 文档助手」直接复用本端配置,文档处理无须跳转。',
];

function pickStaticIntro(): string {
  return STATIC_INTROS[Math.floor(Math.random() * STATIC_INTROS.length)] ?? STATIC_INTROS[0]!;
}

// ── 是否已配置任意可用 LLM 模型 ────────────────────────────────────
function hasUsableLLM(catalog: ProviderCatalogEntry[]): boolean {
  return catalog.some(
    (e) => e.configured && e.enabled && (e.llm_models ?? []).length > 0,
  );
}

// ── 外链 ───────────────────────────────────────────────────────────
const WPS_REPO_URL = 'https://github.com/zhgyuhuii/chayuan';
const OFFICIAL_SITE_URL = 'https://aidooo.com';

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const open = useTabsStore((s) => s.open);
  const navigate = useNavigate();

  const catalogQ = usePlatformCatalogQuery();
  const catalog = catalogQ.data ?? [];
  const ready = hasUsableLLM(catalog);

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('home.greeting.morning');
    if (h < 18) return t('home.greeting.afternoon');
    return t('home.greeting.evening');
  }, [t]);

  const onCapClick = (cap: CapItem) => {
    open(cap.to, { title: cap.title, icon: cap.id });
    void navigate({ to: cap.to as never });
  };

  const onConfigureModel = () => {
    open('/marketplace', { title: '模型广场', icon: 'box' });
    void navigate({ to: '/marketplace' as never });
  };

  const onOpenExternal = (url: string) => {
    void getPlatform().shell.openExternal(url);
  };

  // ── 流式产品介绍 ────────────────────────────────────────────────
  // 行为(2026-05-12 改):进首页拉一次 LLM 流式介绍;流完即停,**不再自动循环**。
  // 旧版每 4s 清空 + 重新流,LLM 不可用时(后端 emit error)会变成每 4s 在静态
  // 文案间反复切换,视觉上"屏幕一直闪烁"。改为单次播放后静止。
  // 离开 tab(unmount / KeepAlive 切到背景)→ AbortController 中止流。
  // LLM 不可用时 catch 一次 → 选一段静态文案落定,不再重试。
  //
  // chunk → setIntro 用 rAF 合并:LLM 高速吐 token 时不再每个 token 都触发
  // HomePage 全树重渲染,显著降低四张能力卡 + 二维码的 reflow 抖动。
  const [intro, setIntro] = React.useState('');
  const [introDone, setIntroDone] = React.useState(false);
  const [introError, setIntroError] = React.useState<string | null>(null);
  const introAbortRef = React.useRef<AbortController | null>(null);
  // rAF 合批:onChunk 把增量塞到 ref,下一帧统一 flush 到 state
  const pendingRef = React.useRef('');
  const rafRef = React.useRef<number | null>(null);

  const flushPending = React.useCallback(() => {
    rafRef.current = null;
    const delta = pendingRef.current;
    if (!delta) return;
    pendingRef.current = '';
    setIntro((prev) => prev + delta);
  }, []);

  const queueChunk = React.useCallback((text: string) => {
    pendingRef.current += text;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  React.useEffect(() => {
    const ctl = new AbortController();
    introAbortRef.current = ctl;
    setIntro('');
    setIntroDone(false);
    setIntroError(null);

    void home.introStream(
      {
        onChunk: queueChunk,
        onDone: () => {
          // 最后一帧 pending 还可能没 flush,补刷一次,再标记 done
          if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          flushPending();
          setIntroDone(true);
        },
      },
      { signal: ctl.signal },
    ).catch((e: unknown) => {
      if ((e as { name?: string })?.name === 'AbortError' || ctl.signal.aborted) return;
      // LLM 不可用 / 调用失败 → 选一段静态文案落定;**不再循环**
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = '';
      setIntro(pickStaticIntro());
      setIntroDone(true);
      setIntroError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      ctl.abort();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = '';
    };
  }, [flushPending, queueChunk]);

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-8 px-6 py-10 overflow-y-auto">
      {/* ── 1. Greeting + 流式介绍气泡 ─────────────────────────── */}
      <div className="flex items-center gap-3">
        <img
          src={CHAYUAN_LOGO_URL}
          alt="察元 AI"
          className="h-12 w-12 bg-transparent object-contain"
        />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--cy-text-primary)]">
            {greeting}
            {user?.username && (
              <span className="ml-2 text-base font-normal text-[var(--cy-text-secondary)]">
                {user.username}
              </span>
            )}
          </h1>
          <p className="text-sm text-[var(--cy-text-tertiary)]">察元 AI · 本地优先的办公 AI 工作台</p>
        </div>
      </div>

      {/* 流式介绍气泡 — 一次播放,流完即静止;不再循环换文案,避免视觉闪烁。
          固定 min-h-[5rem] 让气泡高度不随文字增长抖动,下方卡片不会被反复推开。
          光标用 opacity 1s 步进切换,比 animate-pulse 柔和。 */}
      <div className="flex max-w-3xl items-start gap-3 -mt-3">
        <div className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] flex items-center justify-center text-[11px] font-semibold text-white shadow-sm">
          AI
        </div>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-[var(--cy-surface-base)] px-4 py-3 ring-1 ring-[var(--cy-border-subtle)] shadow-sm">
          <p className="min-h-[5rem] text-sm leading-relaxed text-[var(--cy-text-secondary)]">
            {intro || (introDone ? '' : <TypingDots />)}
            {!introDone && intro && <Caret />}
          </p>
          {introError && (
            <p
              className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]"
              title={introError}
            >
              (LLM 不可用,已用本地文案兜底 — 可前往模型广场配置)
            </p>
          )}
        </div>
      </div>

      {/* ── 2. 未配模型时的引导 banner ────────────────────────── */}
      {!ready && catalogQ.isFetched && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/20">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              还没配置任何可用模型
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-200/80">
              先去模型广场接入云厂商或本地推理服务(Ollama / Infinity / vLLM 等),才能开始对话。
            </p>
          </div>
          <button
            type="button"
            onClick={onConfigureModel}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-600"
          >
            去配置模型
          </button>
        </div>
      )}

      {/* ── 3. 四张炫酷功能入口卡 ────────────────────────────────
          设计:窄屏 2 列、桌面 4 列等宽并列,卡片高度统一 h-40,
          gap 略增到 5,卡内 padding p-5,左上图标 + 左下文案的固定网格,
          上下左右留白对称 — 视觉平衡感比之前 5 列(残余空隙)好。 */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {CAPS.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onCapClick(c)}
              className={`group relative flex h-40 flex-col justify-between overflow-hidden rounded-2xl border border-[var(--cy-border-subtle)] bg-gradient-to-br ${c.gradient} p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--cy-shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-brand-500)]`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm ${c.iconBg}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-[var(--cy-text-primary)]">{c.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--cy-text-secondary)]">{c.subtitle}</p>
              </div>
              {/* 右上角光斑装饰,hover 微移 */}
              <div
                className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/30 blur-2xl transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {/* ── 4. 关注我们 / 收款码 ───────────────────────────────── */}
      <section className="rounded-3xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">支持我们</h2>
          <p className="text-xs text-[var(--cy-text-tertiary)]">扫码关注 / 赞助开发者</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <QrCard label="关注我们" src={FOLLOW_QR_URL} />
          <QrCard label="支付宝赞助" src={ALIPAY_QR_URL} />
          <QrCard label="微信赞助" src={WXPAY_QR_URL} />
        </div>
      </section>

      {/* ── 5. 特性 chips + 外链 ──────────────────────────────────
       * 流式介绍已经移到顶部 greeting 下方(气泡形式 + 自动循环),
       * 这里只剩"特性高亮 chip + 外链按钮",信息密度低、不抢眼,放页底收尾 */}
      <section className="rounded-3xl border border-[var(--cy-border-subtle)] bg-gradient-to-br from-[var(--cy-surface-base)] to-[var(--cy-surface-1)] p-6">
        <div className="flex flex-wrap gap-1.5">
          {FEATURES.map((f) => (
            <span
              key={f}
              className="inline-flex items-center rounded-full bg-[var(--cy-surface-base)] px-2.5 py-1 text-[11px] text-[var(--cy-text-secondary)] ring-1 ring-[var(--cy-border-subtle)]"
            >
              {f}
            </span>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenExternal(WPS_REPO_URL)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-xs text-[var(--cy-text-primary)] transition-all hover:border-[var(--cy-brand-300)] hover:text-[var(--cy-brand-600)]"
            title="WPS 加载项「察元 AI 文档助手」开源地址"
          >
            <Github className="h-3.5 w-3.5" />
            WPS 加载项 · GitHub
            <ExternalLink className="h-3 w-3 opacity-60" />
          </button>
          <button
            type="button"
            onClick={() => onOpenExternal(OFFICIAL_SITE_URL)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-xs text-[var(--cy-text-primary)] transition-all hover:border-[var(--cy-brand-300)] hover:text-[var(--cy-brand-600)]"
            title="察元 AI 官网"
          >
            <Globe className="h-3.5 w-3.5" />
            aidooo.com
            <ExternalLink className="h-3 w-3 opacity-60" />
          </button>
        </div>
      </section>
    </div>
  );
};

// ── 三粒跳动 dots — 流式介绍空白等待期的纯动画占位 ────────────────
// 取代之前的「正在生成介绍…」文字,纯视觉提示 LLM 在思考,文案干净不打断阅读。
const TypingDots: React.FC = () => (
  <span className="inline-flex items-center gap-1 align-middle motion-safe:contents motion-reduce:hidden">
    <span
      className="h-1.5 w-1.5 rounded-full bg-[var(--cy-text-tertiary)] animate-bounce"
      style={{ animationDelay: '-0.3s' }}
    />
    <span
      className="h-1.5 w-1.5 rounded-full bg-[var(--cy-text-tertiary)] animate-bounce"
      style={{ animationDelay: '-0.15s' }}
    />
    <span className="h-1.5 w-1.5 rounded-full bg-[var(--cy-text-tertiary)] animate-bounce" />
  </span>
);

// ── 打字机光标 — 仅流式过程中跟在文末,动画用 motion-safe 包,
//    用户系统勾了"减少动画"时变成静态竖线,不会一直闪。 ──────────────
const Caret: React.FC = () => (
  <span
    aria-hidden
    className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-[var(--cy-text-tertiary)] align-text-bottom motion-safe:animate-pulse"
  />
);

// ── 二维码小卡 ─────────────────────────────────────────────────────
const QrCard: React.FC<{ label: string; src: string }> = ({ label, src }) => (
  <div className="flex flex-col items-center gap-2 rounded-2xl bg-[var(--cy-surface-base)] p-3 ring-1 ring-[var(--cy-border-subtle)]">
    <img
      src={src}
      alt={label}
      className="h-32 w-32 rounded-lg object-contain"
      draggable={false}
    />
    <p className="text-xs font-medium text-[var(--cy-text-secondary)]">{label}</p>
  </div>
);

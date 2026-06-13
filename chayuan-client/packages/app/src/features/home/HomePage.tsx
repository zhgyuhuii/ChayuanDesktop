/**
 * HomePage — 主页(单机版重构 2026-05-09):
 *
 *   1. Greeting(早/午/晚 + 用户名 + Logo)
 *   2. [可选 banner] 还没配模型 → 跳模型厂商
 *   3. 5 张炫酷功能入口卡(知识库 / 模型厂商 / 图转文 / 音转文 / AI 笔记)
 *   4. 按模型类型开始对话(CapabilityCardGrid)
 *   5. 流式产品介绍气泡(进首页跑一次,流完即静止)
 *   6. 招商合作 banner
 *   7. 关注我们 + 收款码 三张二维码
 *
 * 历史:
 *  - 2026-05-09 移除旧版 Composer + 占位能力,首页改为产品入口 + 介绍。
 *  - 2026-05-12 取消"每 4s 自动换文案"循环 — LLM 不可用时它会在静态文案
 *    间反复切,视觉上就是"屏幕闪烁"。改为单次播放 + rAF 合批 chunk 渲染,
 *    气泡固定 min-h 避免内容增长推开下方卡片。
 *  - 2026-05-20 AI 介绍气泡从顶部下移到招商合作 banner 上方 — 让 5 个工具
 *    卡 + CapabilityCardGrid 上移,首屏直接看到全部功能入口。
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Library, Pen, ScanText, Mic, Clapperboard, UserRound,
  AlertCircle, Film, Wand2,
} from 'lucide-react';
import { home, type ProviderCatalogEntry } from '@chayuan/api';
import { useBuyQr } from '../license/useBuyQr';
import { useAuthStore } from '../../store/auth';
import { useTabsStore } from '../../store/tabs';
import { useTranslation } from '../../i18n';
import { usePlatformCatalogQuery } from '../../store/modelPlatform';
import {
  ALIPAY_QR_URL, CHAYUAN_LOGO_URL, FOLLOW_QR_URL, WXPAY_QR_URL,
} from '../../lib/brandAssets';
import { CapabilityCardGrid } from './capabilityCards/CapabilityCardGrid';
import {
  pickBestModel,
  useAvailableModelsByCapability,
} from './capabilityCards/useAvailableModelsByCapability';
import { startCapabilityChat } from './capabilityCards/startCapabilityChat';
import { HomeFxLayer } from './homeFx/HomeFxLayer';
import { CardAura } from './homeFx/CardAura';
import { LicenseDialog } from '../license/LicenseDialog';

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
    id: 'image-to-text',
    icon: ScanText,
    title: '图转文',
    subtitle: '上传图像 · OCR 自动提取文字 · 富文本编辑 · 导出 Word/MD/TXT',
    to: '/image-to-text',
    gradient: 'from-amber-50 to-orange-100 dark:from-amber-900/30 dark:to-orange-800/40',
    iconBg: 'bg-gradient-to-br from-amber-400 to-orange-500',
  },
  {
    id: 'audio-to-text',
    icon: Mic,
    title: '音转文',
    subtitle: '上传音频 · 自动转写并分话人 · 富文本编辑 · 导出 Word/MD/TXT',
    to: '/audio-to-text',
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
  {
    id: 'ai-video',
    icon: Wand2,
    title: 'AI视频生成',
    subtitle: '文生 / 图生视频 · AI 模型直接生成画面',
    to: '/chat',
    gradient: 'from-violet-50 to-fuchsia-100 dark:from-violet-900/30 dark:to-fuchsia-800/40',
    iconBg: 'bg-gradient-to-br from-violet-400 to-fuchsia-500',
  },
  {
    id: 'video-generation',
    icon: Clapperboard,
    title: '图文成片',
    subtitle: '主题 → LLM 文案 → TTS → 字幕 → 素材 → 自动合成 mp4',
    to: '/video-generation',
    gradient: 'from-indigo-50 to-purple-100 dark:from-indigo-900/30 dark:to-purple-800/40',
    iconBg: 'bg-gradient-to-br from-indigo-400 to-purple-500',
  },
  {
    id: 'digital-human',
    icon: UserRound,
    title: '数字人',
    subtitle: '选形象 + 绑音色 → 文案口播 → 一键生成讲话视频',
    to: '/digital-human',
    gradient: 'from-teal-50 to-cyan-100 dark:from-teal-900/30 dark:to-cyan-800/40',
    iconBg: 'bg-gradient-to-br from-teal-400 to-cyan-500',
  },
  {
    id: 'video-editing',
    icon: Film,
    title: '视频编辑',
    subtitle: '时间轴多轨剪辑 · 素材/字幕/音频/画中画 → 合成成片',
    to: '/video-generation/timeline',
    gradient: 'from-slate-50 to-indigo-100 dark:from-slate-900/30 dark:to-indigo-800/40',
    iconBg: 'bg-gradient-to-br from-slate-400 to-indigo-500',
  },
];

// ── 静态介绍文案 fallback(LLM 不可用时随机一段)────────────────────
// 主页介绍气泡的固定文案池(本地循环打字,不调任何大模型)。
const STATIC_INTROS: ReadonlyArray<string> = [
  '察元 AI · 单机版:把多模型对话、本地知识库、离线推理装进同一个桌面应用,装完即用,数据全程留在本机。',
  '面向办公的本地 AI 工作台:多模型并排对话,文档 / 结构化数据 / 向量库统一检索,不联网也能跑。',
  '为离线 / 内网设计:知识库文件、向量索引、对话历史全部存本机 SQLite,不上传任何 SaaS,密钥与文档永不出域。',
  '云模型与本地推理随时切换:Ollama / Infinity / vLLM 等本地服务跟云端 LLM 一起摆在桌面,随时对比试用。',
  '零配置启动:Web / Tauri 桌面 / WPS 加载项 三端共用同一份知识库与对话状态,不强制联网、不强制登录。',
  '知识库一站式:PDF / Word / Excel / Markdown / 网页 / 图像拖进来即解析、切片、向量化,问答自带引用与诊断。',
  '结构化数据问答:"有几个客户""订单总额多少"走只读 SQL 链路,确定性模板 + 校验,不让模型瞎编。',
  '向量与外部检索源:接入外部向量库,按 collection / vector id / metadata / score 返回,来源清清楚楚。',
  '六类能力全本机跑:对话、文本嵌入、重排、语音识别、图像嵌入、OCR,全量版断网即可跑通全部功能。',
  '国产化适配:统信 UOS / 麒麟 / openKylin 等国产桌面与国产 CPU 顺畅运行,信创环境开箱即用。',
  'WPS / Word 文档助手:逐字逐词审错别字、核对引用、规范公文表述,鼠标悬停即出改写建议,一键采纳。',
  '图转文:上传图像 OCR 自动提取文字,富文本编辑后导出 Word / Markdown / TXT。',
  '音转文:上传音频自动转写并分话人,边听边改,导出多格式,会议记录一步到位。',
  'AI 笔记:随手记录、实时语音转文字、自动入库可检索,灵感不再丢。',
  '视频生成:一句主题 → LLM 写文案 → TTS 配音 → 字幕 → 素材 → 自动合成 mp4。',
  '数字人:选形象 + 绑音色 → 文案口播 → 一键生成讲话视频,还能发布为在线数字人对话直播。',
  '视频编辑:时间轴多轨剪辑,素材 / 字幕 / 音频 / 画中画自由编排,一键导出成片。',
  'MCP 工具集中托管:把外部工具与扩展统一接入,让模型能查能用,能力随插随用。',
  '多模型对比评测:同屏并排跑不同模型,谁更准一目了然,选型不再凭感觉。',
  '隐私优先:本地优先、离线可用、数据自管 —— 把 AI 装进你自己的电脑,而不是别人的云。',
];

// 默认权限/免费额度说明(可编辑;后端暂无「每日额度」只读接口,先走文案,真实数字以购买页为准)。
const QUOTA_NOTE = '免费额度有限:每日可免费体验各功能若干次,用完可扫码赞助 / 购买升级';

// ── 是否已配置任意可用 LLM 模型 ────────────────────────────────────
function hasUsableLLM(catalog: ProviderCatalogEntry[]): boolean {
  return catalog.some(
    (e) => e.configured && e.enabled && (e.llm_models ?? []).length > 0,
  );
}

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const open = useTabsStore((s) => s.open);
  const navigate = useNavigate();

  const catalogQ = usePlatformCatalogQuery();
  const catalog = catalogQ.data ?? [];
  const { byCap } = useAvailableModelsByCapability();
  const ready = hasUsableLLM(catalog);

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('home.greeting.morning');
    if (h < 18) return t('home.greeting.afternoon');
    return t('home.greeting.evening');
  }, [t]);

  const onCapClick = (cap: CapItem) => {
    // AI视频生成块:开一个对话式 t2v(对话生成视频),不走普通路由 navigate。
    // 复用能力卡的「按模型类型开始对话」逻辑;无可用 t2v 模型则引导去模型厂商。
    if (cap.id === 'ai-video') {
      const best = pickBestModel(byCap.get('t2v'));
      if (!best) {
        open('/marketplace', { title: '模型厂商', icon: 'server' });
        void navigate({ to: '/marketplace' as never });
        return;
      }
      startCapabilityChat(
        { cap: 't2v', model: best },
        { navigate: (to) => void navigate({ to: to as never }) },
      );
      return;
    }
    // 「AI 笔记」每次进来都是空白:已有 `/notes/new` tab 先关掉,让 NoteEditorPage
    // 重新 mount → useMemo 生成新 draftKey → 不会被上次未保存草稿污染。
    if (cap.id === 'notes') {
      const store = useTabsStore.getState();
      const existing = store.tabs.find((t) => t.path === cap.to);
      if (existing) store.close(existing.id);
    }
    open(cap.to, { title: cap.title, icon: cap.id });
    void navigate({ to: cap.to as never });
  };

  const onConfigureModel = () => {
    open('/marketplace', { title: '模型厂商', icon: 'server' });
    void navigate({ to: '/marketplace' as never });
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
  // 「已购买激活」入口的弹窗开关 — 点页脚链接打开 LicenseDialog(内含序列号输入 + 公众号查询)。
  const [licOpen, setLicOpen] = React.useState(false);

  const [intro, setIntro] = React.useState('');
  // 本地循环打字机:依次打 STATIC_INTROS 每条 → 停顿 → 清空 → 下一条 → 循环。完全不调大模型。
  React.useEffect(() => {
    let alive = true;
    let ti = 0;   // 文案索引(顺序循环)
    let ci = 0;   // 当前文案已打字符数
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      const full = STATIC_INTROS[ti % STATIC_INTROS.length] ?? '';
      if (ci <= full.length) {
        setIntro(full.slice(0, ci));
        ci += 1;
        timer = setTimeout(tick, 55);          // 打字速度
      } else {
        timer = setTimeout(() => {             // 一条打完,停顿
          if (!alive) return;
          ti += 1; ci = 0; setIntro('');
          timer = setTimeout(tick, 350);       // 清空后稍歇,再打下一条
        }, 2400);
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  return (
    <div
      className={[
        // 内容左对齐(mr-auto 而非 mx-auto)— 避免大屏 + sidebar 展开
        // 时容器水平居中,卡片跟左侧 sidebar 之间出现过大空白(用户:
        // "主页内容如卡片 与左侧的面板离的太远")。
        // cy-hide-scrollbar(globals.css)隐藏视觉滚动条但保留滚动能
        // 力 — 解决 sidebar 折叠/展开切换时 overflow-y:auto 弹滚动条
        // 在右侧"占位 15px"造成抖动 → 视觉"右侧被遮挡"假象。
        // overflow-x-hidden 兜底防 fx 子元素越界。
        'relative isolate mr-auto flex h-full flex-col',
        'overflow-x-hidden overflow-y-auto cy-hide-scrollbar',
        'w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl',
        'gap-8 py-10',
      ].join(' ')}
      style={{ paddingLeft: 'clamp(1.5rem, 2.5vw, 3rem)', paddingRight: 'clamp(1.5rem, 2.5vw, 3rem)' }}
    >
      {/* 特效层 — 金龙/凤凰/星空在背景层,内容卡片用 z-10 浮在上面不被遮。
          isolate 强制 HomePage 创建 stacking context,让 fx 的 z:0 严格沉到
          本页内容下方,不会跑到 sidebar/header 之上。 */}
      <HomeFxLayer />

      {/* ── 1. Greeting(Logo + 早/午/晚 + 用户名)───────────────── */}
      <div className="relative z-10 flex items-center gap-3">
        <img
          src={CHAYUAN_LOGO_URL}
          alt="察元 AI"
          className="h-12 w-12 bg-transparent object-contain rounded-full"
          style={{ animation: 'cy-badge-halo 3.6s ease-in-out infinite' }}
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

      {/* ── 2. 未配模型时的引导 banner ────────────────────────── */}
      {!ready && catalogQ.isFetched && (
        <div className="relative z-10 flex items-center gap-3 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/20">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              还没配置任何可用模型
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-200/80">
              先去模型厂商接入云厂商或本地推理服务(Ollama / Infinity / vLLM 等),才能开始对话。
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

      {/* ── 3. 功能入口网格(玻璃拟态)──────────────────────────────
          毛玻璃卡:半透明 + backdrop-blur + 顶部高光 + 彩色渐变图标,
          左对齐 图标/标题/副标题。2 行 × 4 列(窄屏 2 列),与首页背景光效叠加。 */}
      <div className="relative z-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CAPS.map((c, i) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onCapClick(c)}
              title={c.subtitle}
              className="group relative flex h-28 items-start gap-3 overflow-hidden rounded-2xl border border-white/50 bg-white/55 p-3 text-left shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-[var(--cy-brand-400)] hover:shadow-[0_10px_28px_rgba(0,0,0,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-brand-500)] dark:border-white/10 dark:bg-white/[0.06]"
            >
              {/* 每卡专属色(低透明度渐变色调),hover 加深 */}
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.gradient} opacity-25 transition-opacity duration-200 group-hover:opacity-40`}
                aria-hidden
              />
              {/* 顶部玻璃高光 */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
                aria-hidden
              />
              {/* 彩色渐变图标 */}
              <div
                className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ring-1 ring-white/40 ${c.iconBg}`}
                style={{ animation: `cy-icon-float 4s ease-in-out ${i * 0.4}s infinite` }}
              >
                <Icon className="h-5 w-5" />
              </div>
              {/* 标题 + 副标题 */}
              <div className="relative z-10 min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--cy-text-primary)]">{c.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--cy-text-secondary)]">
                  {c.subtitle}
                </p>
              </div>
              <CardAura hue="gold" intensity="subtle" radius={16} />
            </button>
          );
        })}
      </div>

      {/* ── 4. 按模型类型开始对话 ────────────────────────────
       *  7 张 capability 卡(对话 / 视觉 / 文生图 / 图像编辑 / 文生视频
       *  / 语音合成 / 语音识别)。已配模型的卡点击直接新对话并预选最优模型;
       *  未配卡点击弹支持目录,锚跳到对应 cap 段帮用户找申请地址。
       *  数据源跟 ChatComposer 共享 ['v1.models',{type:'all'}] react-query 缓存,
       *  零额外网络。 */}
      <div className="relative z-10">
        <CapabilityCardGrid variant="chips" onMarketplace={onConfigureModel} />
      </div>

      {/* ── 5. 流式产品介绍气泡 ────────────────────────────────
          一次播放,流完即静止;不再循环换文案,避免视觉闪烁。
          固定 min-h-[5rem] 让气泡高度不随文字增长抖动。
          2026-05-20 从顶部下移到此 — 让上方 5 个工具卡 + CapabilityCardGrid
          首屏即可见,产品介绍作为补充信息靠后展示。
          max-w 在宽屏上略放宽(3xl→4xl),但仍约束行长保证阅读舒适。 */}
      <div className="relative z-10 flex max-w-3xl 2xl:max-w-4xl items-start gap-3">
        <div
          className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] flex items-center justify-center text-[11px] font-semibold text-white shadow-sm"
          style={{ animation: 'cy-badge-halo 3.6s 1.2s ease-in-out infinite' }}
        >
          AI
        </div>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-[var(--cy-surface-base)] px-4 py-3 ring-1 ring-[var(--cy-border-subtle)] shadow-sm">
          <p className="min-h-[5rem] text-sm leading-relaxed text-[var(--cy-text-secondary)]">
            {intro || <TypingDots />}
            {intro && <Caret />}
          </p>
        </div>
      </div>

      {/* ── 页脚:两个二维码居中(关注我们 / 购买) + 「已购买」激活入口 ── */}
      <section className="relative z-10 flex flex-col items-center gap-3 pt-1">
        <div className="flex items-center justify-center gap-8">
          <QrCard label="关注我们" src={FOLLOW_QR_URL} />
          <BuyQrCard />
        </div>
        {/* 已购买的用户点这里输入序列号激活 — 弹出复用的 LicenseDialog
            (扫码购买页 + 下方序列号输入框 + 关注公众号查询序列号)。 */}
        <button
          type="button"
          onClick={() => setLicOpen(true)}
          className="text-sm text-[var(--cy-brand-600)] hover:underline"
        >
          已购买？点此输入授权码激活
        </button>
      </section>

      {/* 激活弹窗 — 复用 LicenseDialog。app 与购买二维码保持一致(chat);
          激活时后端按序列号自身编码的模块发放权益,不受此 app 限制。 */}
      <LicenseDialog app="chat" open={licOpen} onOpenChange={setLicOpen} />
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

// ── 常驻二维码小卡(不再 hover) ─────────────────────────────────────
const QrCard: React.FC<{ label: string; src: string }> = ({ label, src }) => (
  <div className="flex flex-col items-center gap-1">
    <img
      src={src}
      alt={label}
      className="h-24 w-24 rounded-lg bg-white object-contain p-1"
      draggable={false}
    />
    <span className="text-[11px] text-[var(--cy-text-secondary)]">{label}</span>
  </div>
);

// ── 购买二维码(动态,复用 useBuyQr) ────────────────────────────────
const BuyQrCard: React.FC = () => {
  const { qrDataUrl } = useBuyQr('chat');
  return (
    <div className="flex flex-col items-center gap-1">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="解锁完整版二维码"
          className="h-24 w-24 rounded-lg bg-white object-contain p-1"
          draggable={false}
        />
      ) : (
        <div className="h-24 w-24 animate-pulse rounded-lg bg-[var(--cy-surface-2)]" />
      )}
      <span className="text-[11px] text-[var(--cy-text-secondary)]">解锁完整版</span>
    </div>
  );
};

/**
 * HomePage —— 首页(参考图"首页 / 首页1")。
 *
 * 段:
 *   1. WelcomeOrb + Greeting(早/午/晚 + 用户名)
 *   2. CapabilityRail(7 张能力 pill + "全部")
 *   3. ChatComposer(中心,glow 常亮)
 *   4. SuggestionCards(推荐卡 3 张,中央 + 末尾 AI 渐变)
 *
 * 数据:
 *   - greeting 按本地时间
 *   - 能力快捷条:packages/api/src/fixtures/skills 后续 M3 起;此处先用本地常量
 *   - 推荐卡:可拉取后端"猜你想问",缺失则用 fixture
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Bot,
  Languages,
  PenSquare,
  StickyNote,
  Captions,
  ImageIcon,
  Sparkles,
} from 'lucide-react';
import { Pill } from '@chayuan/ui';
import { useAuthStore } from '../../store/auth';
import { useComposerStore } from '../../store/composer';
import { CHAYUAN_LOGO_URL } from '../../lib/brandAssets';
import { useTabsStore } from '../../store/tabs';
import { useTranslation } from '../../i18n';
import { ChatComposer } from '../composer/ChatComposer';

interface CapItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  /** 跳转路径 */
  to: string;
}

const CAPS: ReadonlyArray<CapItem> = [
  { id: 'control', icon: Bot, labelKey: 'home.capabilities.control', to: '/skill/control' },
  { id: 'translate', icon: Languages, labelKey: 'home.capabilities.translate', to: '/skill/translate' },
  { id: 'write', icon: PenSquare, labelKey: 'home.capabilities.write', to: '/skill/write' },
  { id: 'memo', icon: StickyNote, labelKey: 'home.capabilities.memo', to: '/skill/memo' },
  { id: 'subtitle', icon: Captions, labelKey: 'home.capabilities.subtitle', to: '/skill/subtitle' },
  { id: 'imageEdit', icon: ImageIcon, labelKey: 'home.capabilities.imageEdit', to: '/skill/image-edit' },
];

interface Suggestion {
  icon: string;
  text: string;
  featured?: boolean;
}

const SUGGESTIONS: ReadonlyArray<Suggestion> = [
  { icon: '💪', text: '节食减肥如何避免伤代谢' },
  { icon: '🎙️', text: '播客:成熟的标志,是学会情绪稳定' },
  { icon: '✨', text: '生成高清星空壁纸', featured: true },
];

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setDraft = useComposerStore((s) => s.setDraft);
  const open = useTabsStore((s) => s.open);
  const navigate = useNavigate();

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('home.greeting.morning');
    if (h < 18) return t('home.greeting.afternoon');
    return t('home.greeting.evening');
  }, [t]);

  const onSend = async (content: string) => {
    // 进入 chat 路径,首次没有 conversationId — ChatPage 会自建
    open('/chat', { title: t('chat.newConversation'), icon: 'message-square' });
    void navigate({ to: '/chat' as never });
    // 把草稿留给 ChatPage 自动 submit:这里直接把内容作为 draft,ChatPage 不会自动发送
    // 简单实现:复用 setDraft;真实自动 submit 留 M5 体验打磨
    setDraft(content);
  };

  const onCapClick = (cap: CapItem) => {
    open(cap.to, { title: cap.labelKey, icon: 'message-square' });
    void navigate({ to: cap.to as never });
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-12">
      {/* Greeting */}
      <div className="flex items-center gap-3">
        <img
          src={CHAYUAN_LOGO_URL}
          alt="察元 AI"
          className="h-12 w-12 bg-transparent object-contain"
        />
        <h1 className="text-2xl font-semibold text-[var(--cy-text-primary)]">
          {greeting}
          {user?.username && (
            <span className="ml-2 text-base font-normal text-[var(--cy-text-secondary)]">
              {user.username}
            </span>
          )}
        </h1>
      </div>

      {/* CapabilityRail */}
      <div className="mt-6 flex flex-wrap gap-2">
        {CAPS.map((c) => {
          const Icon = c.icon;
          return (
            <Pill
              key={c.id}
              tone="outline"
              size="md"
              onClick={() => onCapClick(c)}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(c.labelKey)}
            </Pill>
          );
        })}
      </div>

      {/* Composer */}
      <div className="mt-6">
        <ChatComposer
          isStreaming={false}
          onSend={onSend}
          autoFocus
          minHeight={120}
        />
      </div>

      {/* Suggestions */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => void onSend(s.text)}
            className="relative flex items-center gap-2 overflow-hidden rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4 text-left text-sm text-[var(--cy-text-primary)] transition-colors hover:border-[var(--cy-brand-300)]"
          >
            <span className="text-lg">{s.icon}</span>
            <span className="line-clamp-2 flex-1">{s.text}</span>
            {s.featured && (
              <span
                className="ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white"
                style={{ background: 'var(--cy-iris-gradient)' }}
              >
                <Sparkles className="h-4 w-4" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

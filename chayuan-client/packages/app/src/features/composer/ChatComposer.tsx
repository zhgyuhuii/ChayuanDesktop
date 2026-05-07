/**
 * ChatComposer —— 站点级核心组件(参考图视觉锚点)。
 *
 * 跨页复用:首页(中心) / Chat(底部) / KB / Skill / Marketplace / AI Space。
 *
 * 视觉:
 *   - GlowFrame 霓虹外发光(粉/蓝/绿)
 *   - 顶行:模型选择 pill + 深度思考开关 pill
 *   - 中行:Textarea(IME 安全 + 自适应)
 *   - 底行:工具(剪刀/文件夹/图片)+ 麦克风;右侧黑色圆形发送按钮
 *
 * 行为:
 *   - 草稿持久化(已有 useComposerStore)
 *   - Enter 发送 / Shift+Enter 换行 / Cmd+Enter 强制发送
 *   - IME 防误发
 *   - 流式中按钮变停止
 */

import { GlowFrame, Pill, cn } from '@chayuan/ui';
import {
  ArrowUp,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Scissors,
  Sparkles,
  Square,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from '../../i18n';
import { useComposerStore, useComposerS } from '../../store/composer';
import { McpPickerPill, ToolsPickerPill } from './CapabilityPickers';
import { ComposerModelPill } from './ComposerModelPill';
import { KnowledgePickerPill, type KnowledgePickerPillProps } from './KnowledgePickerPill';
import { SearchModePill } from './SearchModePill';
import type { ComposerModelPillProps } from './ComposerModelPill';

export interface ChatComposerProps {
  isStreaming: boolean;
  placeholder?: string;
  onSend(content: string): void | Promise<void>;
  onStop?: () => void;
  onPickFile?: () => void;
  onPickImage?: () => void;
  onScreenshot?: () => void;
  onMicrophone?: () => void;
  /** 顶行附加内容(附件预览 / 已选工具数等) */
  topSlot?: React.ReactNode;
  /** 放在模型选择器前的场景化控件，例如 KB 选择器。 */
  leadingControls?: React.ReactNode;
  modelPillProps?: ComposerModelPillProps;
  knowledgePillProps?: KnowledgePickerPillProps;
  showKnowledgePicker?: boolean;
  /** 是否禁用霓虹光晕(KB/Skill 等场景可降级为普通框)*/
  glow?: boolean;
  /** 自动 focus */
  autoFocus?: boolean;
  /** 强制最小高度(px) */
  minHeight?: number;
  /** 是否展示 KB 检索专属控件(精准/全面/速度) */
  showRetrievalControls?: boolean;
  /** 放在检索模式 chip 后面的场景化控件。 */
  retrievalTrailingControl?: React.ReactNode;
  /** 浮窗等窄空间隐藏通用工具/MCP,避免关键控件被挤掉。 */
  hideCapabilityControls?: boolean;
  /** 文档助手等窄空间使用图标化控件和单行工具栏。 */
  compactControls?: boolean;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  isStreaming,
  placeholder,
  onSend,
  onStop,
  onPickFile,
  onPickImage,
  onScreenshot,
  onMicrophone,
  topSlot,
  leadingControls,
  modelPillProps,
  knowledgePillProps,
  showKnowledgePicker = true,
  glow = true,
  autoFocus = false,
  minHeight = 72,
  showRetrievalControls = false,
  retrievalTrailingControl,
  hideCapabilityControls = false,
  compactControls = false,
}) => {
  const { t } = useTranslation();
  const draft = useComposerS((s) => s.draft);
  const setDraft = useComposerS((s) => s.setDraft);
  const deepThink = useComposerS((s) => s.deepThink);
  const toggleDeepThink = useComposerS((s) => s.toggleDeepThink);
  const modelId = useComposerS((s) => s.modelId);
  const selectedKuCount = useComposerS((s) => s.selectedKuIds.length);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const composingRef = React.useRef(false);

  const ph = placeholder ?? t('chat.inputPlaceholder', { model: modelId });

  React.useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draft changes must recalc textarea height.
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(minHeight - 24, Math.min(el.scrollHeight, 220))}px`;
  }, [draft, minHeight]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    // 行业惯例(ChatGPT / Claude / Cursor):点发送立刻清空输入框 + 让消息进列表,
    // SSE 流式由 onSend 在后台跑。之前 await onSend 完才 setDraft 会让用户在
    // 整段流式期间看见输入框还有内容,体验割裂。
    setDraft('');
    try {
      await onSend(text);
    } catch (e) {
      // onSend 抛错(网络断 / 鉴权过期 / 后端 503)→ 把内容回填到输入框,
      // 让用户能编辑后再次发送,而不是直接丢失
      setDraft(text);
      throw e;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    if (composingRef.current) return;
    e.preventDefault();
    void submit();
  };

  const Inner = (
    <div
      className={cn(
        'flex flex-col',
        compactControls ? 'p-3' : 'p-4',
        glow ? 'rounded-3xl' : 'rounded-2xl border border-[var(--cy-border-subtle)]',
      )}
    >
      {topSlot && <div className="mb-2">{topSlot}</div>}

      <textarea
        ref={taRef}
        value={draft}
        rows={1}
        placeholder={ph}
        className={cn(
          'w-full resize-none border-0 bg-transparent text-sm text-[var(--cy-text-primary)] placeholder:text-[var(--cy-text-tertiary)]',
          'focus-visible:outline-none',
        )}
        style={{ minHeight: minHeight - 24 }}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={onKeyDown}
      />

      <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 pb-0.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {leadingControls}
          {showKnowledgePicker && (
            <KnowledgePickerPill
              {...knowledgePillProps}
              iconOnly={compactControls || knowledgePillProps?.iconOnly}
            />
          )}
          <ComposerModelPill {...modelPillProps} iconOnly={compactControls || modelPillProps?.iconOnly} />

          <Pill
            tone={deepThink ? 'ink' : 'outline'}
            size="sm"
            active={deepThink}
            onClick={toggleDeepThink}
            aria-label={t('chat.deepThink')}
            aria-pressed={deepThink}
            title={t('chat.deepThink')}
            className="h-8 w-8 shrink-0 justify-center px-0"
          >
            <Sparkles className="h-3 w-3" />
          </Pill>

          {!hideCapabilityControls && (
            <>
              {/* 能力多选,工具/MCP 各占一枚 pill;KB 不在通用对话出现 */}
              <ToolsPickerPill />
              <McpPickerPill />
            </>
          )}
          {/* 检索模式 chip:仅在知识/办公对话中显示 */}
          {showRetrievalControls && selectedKuCount > 0 && <SearchModePill forceVisible />}
          {retrievalTrailingControl}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <IconBtn aria-label={t('chat.scissors')} title={t('chat.scissors')} onClick={onScreenshot}>
            <Scissors className="h-4 w-4" />
          </IconBtn>
          <IconBtn aria-label={t('chat.uploadFile')} title={t('chat.uploadFile')} onClick={onPickFile}>
            <Paperclip className="h-4 w-4" />
          </IconBtn>
          <IconBtn aria-label={t('chat.uploadImage')} title={t('chat.uploadImage')} onClick={onPickImage}>
            <ImageIcon className="h-4 w-4" />
          </IconBtn>
          <IconBtn aria-label={t('chat.voice')} title={t('chat.voice')} onClick={onMicrophone}>
            <Mic className="h-4 w-4" />
          </IconBtn>

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t('chat.stop')}
              className={cn(
                'ml-2 flex h-9 w-9 items-center justify-center rounded-full',
                'bg-red-500 text-white hover:bg-red-600',
              )}
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => void submit()}
              aria-label={t('chat.send')}
              className={cn(
                'ml-2 flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                draft.trim()
                  ? 'bg-[var(--cy-ink-700)] text-white hover:bg-[var(--cy-ink-800)]'
                  : 'cursor-not-allowed bg-[var(--cy-surface-2)] text-[var(--cy-text-tertiary)]',
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (!glow) return Inner;
  return (
    <GlowFrame intensity="md" radius={24}>
      {Inner}
    </GlowFrame>
  );
};

const IconBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => (
  <button
    type="button"
    className={cn(
      'flex h-8 w-8 items-center justify-center rounded-full text-[var(--cy-text-secondary)] transition-colors',
      'hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]',
      className,
    )}
    {...props}
  />
);

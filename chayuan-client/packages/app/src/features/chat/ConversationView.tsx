/**
 * ConversationView — 可复用的"对话视图"组件。
 *
 * 设计目标:
 *   ChatPage 的 messages-list + composer + 状态机交互可以被多处复用 —
 *   KbDetail 内的"在该 KB 里聊"、Skill 内的"用此模板对话"、未来的多模态对话页
 *   都不应当各自再实现一遍。把这部分作为单一组件抽出,保持 ChatPage 仅做
 *   header/empty 这种页面级装饰。
 *
 * 职责(从 ChatPage 平移过来):
 *   1. 持有 useChayuanChat 状态机
 *   2. 切换 conversationId → listMessages 加载本地消息
 *   3. 流式结束时落库(upsertConversation + appendMessage)
 *   4. 草稿模式下首次发送 lazy 创建会话(uuid + upsertConversation),
 *      通过 onConversationCreated 把 id 上抛,父级决定 url / tab path / activeId 怎么处理
 *   5. 透传文件 / 图片 attachments
 *   6. 流式结束时把消息同步给 artifactStore
 *
 * 不做的事:
 *   - 模型选择 / 高级参数(由调用方塞 headerSlot)
 *   - StreamMetrics(可选,通过 metricsSlot 注入)
 *   - 全局 layout(高度、面包屑、返回按钮等由调用方决定)
 *
 * 高性能要点:
 *   - useComposerStore 的字段全部走单字段 selector,避免输入框打字时整页重渲
 *   - useChayuanChat 的 setMessages 引用稳定,放进 effect deps 不会死循环
 *   - 流式过程中**不**写库,仅 isStreaming true→false 落最后两条,避免 token 级 IO 抖动
 */

import { uuid } from '@chayuan/platform-shared';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { CHAYUAN_LOGO_URL } from '../../lib/brandAssets';
import { useComposerS, useComposerScopedStore } from '../../store/composer';
import { useArtifactSync } from '../artifact/useArtifactSync';
import { ChatComposer } from '../composer/ChatComposer';
import { useChatScreenshot } from '../composer/useChatScreenshot';
import {
  appendMessage,
  getConversation,
  listMessages,
  upsertConversation,
} from '../conversations/persistence';
import { CONVERSATION_KEYS } from '../conversations/useConversations';
import { AttachmentBar } from './AttachmentBar';
import { Thread } from './Thread';
import { buildChatRequest } from './buildRequest';
import { useAttachments } from './useAttachments';
import { useChayuanChat } from './useChayuanChat';

export interface ConversationViewProps {
  /** 当前激活会话 id;null/undefined = 草稿模式(首条消息时 lazy 创建) */
  conversationId?: string | null;
  /**
   * 草稿模式下,首条消息发送时回调 — 父级在此把新 id 同步到自己的状态/路由。
   * `mode` 用于落库:'kb' / 'agent' / 'plain' / 'skill';不传走自动推断。
   */
  onConversationCreated?: (id: string, title: string) => void;
  /** 显式落库 mode;不传走 selectedKbsLen>0?'kb':selectedToolsLen>0?'agent':'plain' 推断 */
  mode?: 'kb' | 'agent' | 'plain' | 'skill';
  /** 顶部插槽:模型选择器 / 高级参数 / Stream 指标 etc.;不传则不渲染 header */
  headerSlot?: React.ReactNode;
  /** 消息为空时的占位 — 不传走默认欢迎屏 */
  emptySlot?: React.ReactNode;
  /** 找不到该会话时的展示 — 不传走默认提示 */
  missingSlot?: React.ReactNode;
  /** 是否允许附件(文件 / 图片);默认 true */
  enableAttachments?: boolean;
  /** 输入框 placeholder 透传 */
  placeholder?: string;
  /**
   * 自定义 buildRequest — 默认走 buildChatRequest(取自全局 composer store)。
   * KbDetail 等场景可以塞固定 KB 范围进去,绕开全局 composer。
   */
  buildRequest?: Parameters<typeof useChayuanChat>[0]['buildRequest'];
  /** 容器额外 className(布局微调用) */
  className?: string;
  /**
   * 96 题:外部拦截器 — 在 useChayuanChat.sendMessage 之前调用。
   * 返 true → 跳过本实例发送(由外部接管,如 Arena 统一发送 fanout 到所有 lane)。
   * 返 false / undefined → 正常本实例发送。
   */
  onBeforeSend?: (text: string) => boolean | Promise<boolean>;
  /**
   * 96 题:暴露 sendMessage 给父级。Lane 把它注册到 SendRegistry 用于 fanout。
   */
  sendMessageRef?: React.MutableRefObject<((text: string) => Promise<void>) | null>;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  conversationId,
  onConversationCreated,
  mode,
  headerSlot,
  emptySlot,
  missingSlot,
  enableAttachments = true,
  placeholder,
  buildRequest,
  className,
  onBeforeSend,
  sendMessageRef,
}) => {
  const activeId = conversationId ?? null;
  const composer = useComposerScopedStore();
  const setActive = useComposerS((s) => s.setActive);
  const modelId = useComposerS((s) => s.modelId);
  // P0:含 src:* 的 ku 选中也算 kb,否则结构化/图像 KB 不会落 mode='kb'
  const selectedKbsLen = useComposerS(
    (s) => s.selectedKbs.length + s.selectedKuIds.filter((x) => x.startsWith('src:')).length,
  );
  const selectedToolsLen = useComposerS((s) => s.selectedTools.length);
  const qc = useQueryClient();
  const attachments = useAttachments();
  const screenshot = useChatScreenshot(attachments.addImages);

  const chat = useChayuanChat({
    conversationId: activeId ?? undefined,
    buildRequest:
      buildRequest ??
      (({ messages, query }) => buildChatRequest(query, messages, composer.getState())),
    onBranch: async (newConvId, snapshot) => {
      const now = Date.now();
      await upsertConversation({
        id: newConvId,
        remote_id: null,
        title: `${snapshot[0]?.content?.slice(0, 30) ?? '分支'} (分叉)`,
        model: modelId,
        mode: 'agent',
        created_at: now,
        updated_at: now,
      });
      for (const m of snapshot) await appendMessage(newConvId, m);
      setActive(newConvId);
      void qc.invalidateQueries({ queryKey: CONVERSATION_KEYS.list });
    },
  });

  useArtifactSync(chat.messages);

  // 切换 activeId → 加载本地消息
  const setChatMessages = chat.setMessages;
  const lastLoadedRef = React.useRef<string | null>(null);
  const [convMissing, setConvMissing] = React.useState(false);
  // 已存在会话首次加载期间(listMessages 异步未返回前)显示骨架动画 — 用户进窗口
  // 立刻有动画,不会先看到一帧空白欢迎屏然后突然切到消息列表
  const [initialLoading, setInitialLoading] = React.useState(!!conversationId);
  // 关键:草稿模式 lazy-create 时,父级会把 conversationId 从 null 切到新 id;
  // 这一刻 in-memory 已经有 user 消息(刚 push 的)/ assistant 流式中,但本地
  // 数据库 listMessages(newId) 必然返回 [](还没 upsert);如果无脑 setChatMessages([])
  // 就会把流式中的消息抹掉 → 用户看到"消息列表为空"。修法:检测到内存里
  // 有消息但本地为空时,跳过覆盖,等 streaming 结束再让落库 effect 补 db。
  const messagesLenRef = React.useRef(0);
  messagesLenRef.current = chat.messages.length;
  React.useEffect(() => {
    if (!activeId) {
      setChatMessages((prev) => (prev.length === 0 ? prev : []));
      lastLoadedRef.current = null;
      setConvMissing(false);
      setInitialLoading(false);
      return;
    }
    if (lastLoadedRef.current === activeId) return;
    lastLoadedRef.current = activeId;
    setConvMissing(false);
    setInitialLoading(true);
    let cancelled = false;
    void (async () => {
      const msgs = await listMessages(activeId);
      if (cancelled) return;
      // 仅当"内存为空 或 本地确实有消息"时覆盖;否则保留内存(草稿首发场景)
      if (msgs.length > 0 || messagesLenRef.current === 0) {
        setChatMessages(msgs);
      }
      setInitialLoading(false);
      if (msgs.length !== 0 || !/^[0-9a-f-]{20,}$/i.test(activeId)) return;
      const conv = await getConversation(activeId);
      if (cancelled) return;
      if (conv) return;
      await new Promise((r) => setTimeout(r, 200));
      if (cancelled) return;
      const conv2 = await getConversation(activeId);
      if (cancelled) return;
      if (!conv2) setConvMissing(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, setChatMessages]);

  // 流式结束(true→false)→ 落库
  const wasStreamingRef = React.useRef(false);
  React.useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = chat.isStreaming;
    if (!wasStreaming || chat.isStreaming) return;
    const cid = activeId;
    if (!cid || chat.messages.length === 0) return;
    void (async () => {
      const last = chat.messages[chat.messages.length - 1];
      const second = chat.messages[chat.messages.length - 2];
      const now = Date.now();
      const title = chat.messages.find((m) => m.role === 'user')?.content.slice(0, 40) || '新对话';
      const inferredMode = mode ?? (selectedKbsLen ? 'kb' : selectedToolsLen ? 'agent' : 'plain');
      await upsertConversation({
        id: cid,
        remote_id: null,
        title,
        model: modelId,
        mode: inferredMode,
        created_at: now,
        updated_at: now,
      });
      if (second) await appendMessage(cid, second);
      if (last) await appendMessage(cid, last);
      void qc.invalidateQueries({ queryKey: CONVERSATION_KEYS.list });
    })();
  }, [
    chat.isStreaming,
    chat.messages,
    activeId,
    modelId,
    selectedKbsLen,
    selectedToolsLen,
    mode,
    qc,
  ]);

  /**
   * 96 题:统一发送 dispatch。
   *
   * - opts.bypassUnified:跳过 onBeforeSend 拦截器。
   *   父级(MultiLaneShell.broadcast)统一发送时,会反过来调每条 lane 的
   *   ``sendMessageRef.current(text)``,调到的是这个函数本身;如果不 bypass,
   *   每条 lane 又会触发自己的 onBeforeSend → broadcast → 死循环。
   *   bypass=true 让父级 dispatch 走完整 handleSend 流程(草稿建 / setActive
   *   / onConversationCreated / chat.sendMessage),但跳掉拦截器这一步。
   *
   * - 用户主动按发送(走 ChatComposer.onSend)→ bypass=false → onBeforeSend
   *   先看 unifiedSend,unifiedSend=ON 时由 broadcast 接管(本调用早退);
   *   OFF 时正常走完整流程。
   */
  const handleSend = async (text: string, opts: { bypassUnified?: boolean } = {}) => {
    if (!opts.bypassUnified && onBeforeSend) {
      const shouldSkip = await onBeforeSend(text);
      if (shouldSkip) return;
    }
    if (!activeId) {
      // 草稿模式 → 第一次发消息才落库
      const id = uuid();
      const now = Date.now();
      const title = text.slice(0, 40) || '新对话';
      const inferredMode = mode ?? (selectedKbsLen ? 'kb' : selectedToolsLen ? 'agent' : 'plain');
      await upsertConversation({
        id,
        remote_id: null,
        title,
        model: modelId,
        mode: inferredMode,
        created_at: now,
        updated_at: now,
      });
      setActive(id);
      onConversationCreated?.(id, title);
      void qc.invalidateQueries({ queryKey: CONVERSATION_KEYS.list });
    }
    // 双轨 OCR:把图片附件的 OCR 文本拼进 prompt,跟原图(vision)并行发给模型
    let finalText = text;
    if (enableAttachments) {
      const ocrAppendix = attachments.getOcrPromptAppendix();
      if (ocrAppendix) finalText = text + ocrAppendix;
    }
    await chat.sendMessage(finalText);
    if (enableAttachments) attachments.reset();
  };

  // 暴露给父级的 sendMessage(给 MultiLaneShell.broadcast 用):
  // 走完整 handleSend(草稿创建 / 落库 / 流式),但跳过 onBeforeSend 防 broadcast 死循环。
  // 之前直接绑 chat.sendMessage 是 bug — 那个 raw fn 绕过草稿创建,activeId=null 时
  // 静默不发,导致"统一发送没反应,输入丢失"。
  const handleSendRef = React.useRef(handleSend);
  handleSendRef.current = handleSend;
  React.useEffect(() => {
    if (!sendMessageRef) return;
    sendMessageRef.current = (text: string) => handleSendRef.current(text, { bypassUnified: true });
    return () => {
      if (sendMessageRef) sendMessageRef.current = null;
    };
  }, [sendMessageRef]);

  return (
    <div className={`flex h-full flex-col ${className ?? ''}`}>
      {headerSlot}

      {chat.messages.length ? (
        <Thread
          messages={chat.messages}
          onRegenerate={chat.regenerate}
          onResume={(approved) => void chat.resumeWithDecision({ approved })}
          onEdit={(id, newContent) => void chat.editMessage(id, newContent)}
          onBranch={(id) => void chat.branchFrom(id)}
        />
      ) : convMissing ? (
        (missingSlot ?? (
          <DefaultMissing
            onReset={() => {
              setActive(null);
              setConvMissing(false);
            }}
          />
        ))
      ) : initialLoading ? (
        <ChatLoadingSkeleton />
      ) : (
        (emptySlot ?? <DefaultEmpty />)
      )}

      <div className="mx-auto w-full max-w-3xl space-y-2 p-4">
        <ChatComposer
          isStreaming={chat.isStreaming}
          onSend={handleSend}
          onStop={chat.stop}
          placeholder={placeholder}
          showRetrievalControls={mode === 'kb'}
          {...(enableAttachments
            ? {
                onPickFile: () => void attachments.pickFiles(),
                onPickImage: () => void attachments.pickImages(),
                onScreenshot: screenshot.available ? screenshot.onScreenshot : undefined,
                topSlot: attachments.attachments.length ? (
                  <AttachmentBar items={attachments.attachments} onRemove={attachments.remove} />
                ) : null,
              }
            : {})}
        />
      </div>
    </div>
  );
};

/**
 * 已存在会话首次加载期间的骨架动画 — 替代之前会闪一帧的"欢迎屏"。
 *
 * 三条仿消息条目从天而降,带 shimmer 渐变。用户进窗口的瞬间就有动作,
 * 即便 listMessages 慢一点也不会让人误以为"对话是空的"。
 */
const ChatLoadingSkeleton: React.FC = () => (
  <div className="flex flex-1 flex-col gap-4 px-6 py-8" aria-busy="true" aria-live="polite">
    <SkeletonRow side="left" widths={['85%', '70%', '40%']} delay={0} />
    <SkeletonRow side="right" widths={['60%', '45%']} delay={120} />
    <SkeletonRow side="left" widths={['80%', '55%']} delay={240} />
    <span className="sr-only">正在加载对话</span>
    <style>{`
      @keyframes cySkelShimmer {
        0% { background-position: -120% 0; }
        100% { background-position: 220% 0; }
      }
      @keyframes cySkelFadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  </div>
);

const SkeletonRow: React.FC<{ side: 'left' | 'right'; widths: string[]; delay: number }> = ({
  side,
  widths,
  delay,
}) => (
  <div
    className={`flex max-w-3xl gap-3 ${side === 'right' ? 'ml-auto flex-row-reverse' : ''}`}
    style={{
      opacity: 0,
      animation: 'cySkelFadeIn 280ms ease-out forwards',
      animationDelay: `${delay}ms`,
    }}
  >
    <div className="h-8 w-8 flex-shrink-0 rounded-full bg-muted/70" />
    <div className={`flex flex-col gap-2 ${side === 'right' ? 'items-end' : 'items-start'}`}>
      {widths.map((w, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: widths 是静态数组,渲染期间不重排;index 即唯一稳定键
          key={`${side}-${i}`}
          className="h-4 rounded-md bg-gradient-to-r from-muted/40 via-muted/80 to-muted/40 bg-[length:220%_100%]"
          style={{
            width: w,
            animation: 'cySkelShimmer 1.4s linear infinite',
            animationDelay: `${i * 120}ms`,
          }}
        />
      ))}
    </div>
  </div>
);

/** 默认欢迎屏 — ChatPage 老形态 */
const DefaultEmpty: React.FC = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
    <div className="text-center">
      <img
        src={CHAYUAN_LOGO_URL}
        alt="察元 AI"
        className="mx-auto mb-4 h-12 w-12 bg-transparent object-contain"
      />
      <h1 className="text-2xl font-semibold">你好,我是察元 AI</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        问点什么开始对话;可拖拽文件;工具 / MCP 见输入框下方
      </p>
    </div>
  </div>
);

/** 默认"会话不存在"占位 */
const DefaultMissing: React.FC<{ onReset(): void }> = ({ onReset }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
    <div className="text-center max-w-md">
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-xl font-semibold">
        ?
      </div>
      <h1 className="text-xl font-semibold">会话已不存在</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        这个会话可能在其他端已删除,或链接已失效。在下方输入框直接发消息可开新对话。
      </p>
      <button
        type="button"
        className="mt-4 rounded-full bg-[var(--cy-ink-700)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-ink-800)]"
        onClick={onReset}
      >
        开始新对话
      </button>
    </div>
  </div>
);

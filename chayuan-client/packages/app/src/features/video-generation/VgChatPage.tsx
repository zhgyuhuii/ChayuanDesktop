/**
 * 视频生成 chat-driven 入口 — R3.6 真复用版本。
 *
 * 用户审核 N4-N8 时严厉指出:那时的 mini-composer / 自定义 messages 状态机
 * **不是真复用** — 跟 ChatComposer / ConversationView 完全没共用代码。
 * 本文件全量重写:
 *
 *   - <ComposerStoreContext.Provider value={vgComposerStore}>:注入 video-generation
 *     scope 的 composer store,跟全局 chat store 完全隔离(draft / modelId / attachments
 *     互不污染)。ChatComposer 自动从 Context 拿到这个 store,所有内部 selector
 *     无感切换。
 *   - <ConversationView mode="video_generation" extraSlot={...}>:复用消息流 /
 *     流式 / 落库 / 滚动 / 编辑 / regenerate / branch 全套能力,N4 自实现的
 *     ``MessageBlock + messages useState + scrollRef`` 全删。
 *   - extraSlot:每条 assistant message 下方挂 VgMessageExtras(TtsCard / 字幕图标 /
 *     去生成按钮 / RenderProgressCard),靠 message.metadata.videoMeta 驱动。
 *   - VgComposerToolbar:Composer 上方 7-chip 工具栏(模型 / 画幅 / 语言 / 段落 /
 *     音频 / 字幕 / 全自动),关键配置全部显式露,不再藏 popover 反模式。
 *
 * 多任务:每条 assistant message 各自独立 metadata.videoMeta,用户可以在同一
 * 对话内连续提多个主题,每条独立 TTS / 字幕 / 去生成 / 渲染进度。
 *
 * 全自动模式(⚡ on):
 *   onBeforeSend 拦截 → 直接 videoGeneration.submitTask(script_source='ai'),
 *   跳过 chat 路径。提交成功后 toast 提示用户去"我的视频"看进度
 *  (InProgressTasksPanel 已在 ``/video-generation/library`` 渲染并发任务)。
 *   失败走 reportError。
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Layers, Library as LibIcon, MessagesSquare, Video as VideoIcon } from 'lucide-react';

import { videoGeneration } from '@chayuan/api';
import type { ChatMessage } from '../chat/useChayuanChat';
import { ConversationView } from '../chat/ConversationView';
import { buildChatRequest } from '../chat/buildRequest';
import { ComposerStoreContext } from '../../store/composer';
import { useTabsStore } from '../../store/tabs';
import { notifySuccess, reportError } from '../../store/errorDialog';

import { vgComposerStore } from './store/vgComposerStore';
import { useVgComposer } from './store/vgComposer';
import { VgComposerToolbar } from './VgComposerToolbar';
import { VgMessageExtras } from './VgMessageExtras';

export interface VgChatPageProps {
  /** 由 tab.path(/video-generation/<id>)解析,null=草稿模式。 */
  conversationId?: string | null;
}

export const VgChatPage: React.FC<VgChatPageProps> = ({ conversationId = null }) => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const [autoMode, setAutoMode] = React.useState(false);

  // ConversationView 内部的 chat.setMessages — 通过下方 messagesRef 暴露,
  // VgMessageExtras 的 onMetaChange / onSubmit 用这个 setter 改 metadata。
  const setMessagesRef = React.useRef<
    React.Dispatch<React.SetStateAction<ChatMessage[]>> | null
  >(null);

  // ── 顶部导航跳转 ─────────────────────────────────────────────
  const goBatch = React.useCallback(() => {
    openTab('/video-generation/batch', { title: '批量生成', icon: 'layers' });
    void navigate({ to: '/video-generation/batch' as never });
  }, [openTab, navigate]);
  const goMaterials = React.useCallback(() => {
    openTab('/video-generation/materials', { title: '素材库', icon: 'library' });
    void navigate({ to: '/video-generation/materials' as never });
  }, [openTab, navigate]);
  const goLibrary = React.useCallback(() => {
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  }, [openTab, navigate]);

  // ── VgMessageExtras 回调 ────────────────────────────────────
  // 用户改 TTS / BGM / 字幕 → patch 到对应 message.metadata.videoMeta(浅 merge)
  const onMetaChange = React.useCallback(
    (messageId: string, patch: Record<string, unknown>) => {
      const setMessages = setMessagesRef.current;
      if (!setMessages) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const prevVm = m.metadata?.videoMeta ?? {};
          return {
            ...m,
            metadata: {
              ...(m.metadata ?? {}),
              videoMeta: { ...prevVm, ...patch },
            },
          };
        }),
      );
    },
    [],
  );

  // 用户点"去生成视频"→ 拿当前 message 的 videoMeta + vgComposer 全局参数
  // 提交任务,把 task_id / renderState 写回 metadata,触发 RenderProgressCard
  const onSubmit = React.useCallback(
    async (messageId: string) => {
      const setMessages = setMessagesRef.current;
      if (!setMessages) return;
      // 先快照当前 message 内容,异步提交期间用户不会再改它
      let snapshot: ChatMessage | undefined;
      setMessages((prev) => {
        snapshot = prev.find((m) => m.id === messageId);
        return prev;
      });
      if (!snapshot) return;
      const vm = snapshot.metadata?.videoMeta ?? {};
      const script = (snapshot.content ?? '').trim();
      const base = useVgComposer.getState().params;
      const params = {
        ...base,
        video_script: script || base.video_script,
        script_source: 'manual' as const,
        voice_provider: vm.tts?.provider ?? base.voice_provider,
        voice_name: vm.tts?.voice ?? base.voice_name,
        voice_rate: vm.tts?.rate ?? base.voice_rate,
        voice_volume: vm.tts?.volume ?? base.voice_volume,
        bgm_type: vm.bgm?.type ?? base.bgm_type,
        bgm_file: vm.bgm?.file ?? base.bgm_file,
        bgm_volume: vm.bgm?.volume ?? base.bgm_volume,
        video_aspect: (vm.videoAspect ?? base.video_aspect) as typeof base.video_aspect,
      };
      try {
        const t = await videoGeneration.submitTask(params, { stop_at: 'video' });
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const prevVm = m.metadata?.videoMeta ?? {};
            return {
              ...m,
              metadata: {
                ...(m.metadata ?? {}),
                videoMeta: {
                  ...prevVm,
                  taskId: t.task_id,
                  renderState: 'running' as const,
                },
              },
            };
          }),
        );
        notifySuccess(`任务已提交 ${t.task_id.slice(0, 8)}…`);
      } catch (e) {
        reportError(e as Error, '提交任务失败');
      }
    },
    [],
  );

  // ── 自定义 buildRequest:把 mode 钉死 video_generation ─────────
  // 走默认 buildChatRequest 的字段映射(model / history / kb / ...),仅
  // 覆盖 mode — 后端 chat handler dispatcher 按这个 mode 路由到
  // chayuan.server.chat.handlers.video_generation。
  const buildRequest = React.useCallback<
    NonNullable<React.ComponentProps<typeof ConversationView>['buildRequest']>
  >(
    ({ messages, query }) => {
      const composer = vgComposerStore.getState();
      const req = buildChatRequest(query, messages, composer);
      return { ...req, mode: 'video_generation' };
    },
    [],
  );

  // ── 全自动模式拦截 ───────────────────────────────────────────
  // onBeforeSend 返 true → ConversationView 跳过 chat.sendMessage(本拦截器接管)
  const onBeforeSend = React.useCallback(
    async (text: string): Promise<boolean> => {
      if (!autoMode) return false;
      const subj = text.trim();
      if (!subj) return false;
      const params = { ...useVgComposer.getState().params, video_subject: subj, script_source: 'ai' as const };
      try {
        const t = await videoGeneration.submitTask(params, { stop_at: 'video' });
        notifySuccess(
          `已提交全自动任务 ${t.task_id.slice(0, 8)}…`,
          '前往"我的视频"看实时进度',
        );
        // 小延迟跳转,避免 toast 还没显示就切页
        setTimeout(goLibrary, 800);
      } catch (e) {
        reportError(e as Error, '全自动提交失败');
      }
      return true; // skip chat path
    },
    [autoMode, goLibrary],
  );

  // ── 顶部 header — brand 渐变背景 + 大 Video 图标,明显标记"视频生成对话" ──
  const header = (
    <header className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] bg-gradient-to-r from-[var(--cy-brand-50)] to-[var(--cy-surface-1)] px-4 py-2.5">
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] text-white shadow-sm">
          <VideoIcon className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-[var(--cy-text-primary)]">视频生成 · 对话模式</div>
          <div className="inline-flex items-center gap-1 text-[10px] text-[var(--cy-text-tertiary)]">
            <MessagesSquare className="h-2.5 w-2.5" />
            主题 → 脚本 → 配置 → 渲染,全程在对话内
          </div>
        </div>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={goBatch}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
        >
          <Layers className="h-3 w-3" /> 批量
        </button>
        <button
          type="button"
          onClick={goMaterials}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
        >
          <LibIcon className="h-3 w-3" /> 素材
        </button>
        <button
          type="button"
          onClick={goLibrary}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
        >
          <VideoIcon className="h-3 w-3" /> 我的视频
        </button>
      </div>
    </header>
  );

  // ── Composer 正上方的精致工具栏(画幅/语言/段落/语音设置/字幕设置/全自动) ──
  const composerTop = (
    <VgComposerToolbar autoMode={autoMode} onAutoModeChange={setAutoMode} />
  );

  return (
    <ComposerStoreContext.Provider value={vgComposerStore}>
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1">
          <ConversationView
            conversationId={conversationId}
            mode="video_generation"
            placeholder="输入视频主题 / 拖文件入素材库"
            buildRequest={buildRequest}
            onBeforeSend={onBeforeSend}
            setMessagesRef={setMessagesRef}
            composerTopSlot={composerTop}
            assistantEditable
            extraSlot={(m) => (
              <VgMessageExtras
                message={m}
                onMetaChange={onMetaChange}
                onSubmit={onSubmit}
              />
            )}
          />
        </div>
      </div>
    </ComposerStoreContext.Provider>
  );
};

export default VgChatPage;

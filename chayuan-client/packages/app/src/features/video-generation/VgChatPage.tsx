/**
 * 视频生成 chat-driven 入口 — R3.6 真复用版本。
 *
 * ... (see original comments)
 *
 * 按次门控（video）:
 *   onBeforeSend 拦截（全自动模式）时先调 consume('video')；
 *   onSubmit（去生成视频按钮）时也先门控。
 *   allowed=false → 弹购买弹层，阻止执行。
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Film, Layers, Library as LibIcon, MessagesSquare, Video as VideoIcon } from 'lucide-react';

import { videoGeneration } from '@chayuan/api';
import type { ChatMessage } from '../chat/useChayuanChat';
import { ConversationView } from '../chat/ConversationView';
import { buildChatRequest } from '../chat/buildRequest';
import { ComposerStoreContext } from '../../store/composer';
import { useTabsStore } from '../../store/tabs';
import { notifySuccess, reportError } from '../../store/errorDialog';
import { useUsageGate, UsageGateDialogs } from '../license';

import { vgComposerStore, resolveVgChatModel } from './store/vgComposerStore';
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

  // 按次门控（video）
  const gate = useUsageGate('video');

  // ConversationView 内部的 chat.setMessages — 通过下方 messagesRef 暴露,
  // VgMessageExtras 的 onMetaChange / onSubmit 用这个 setter 改 metadata。
  const setMessagesRef = React.useRef<
    React.Dispatch<React.SetStateAction<ChatMessage[]>> | null
  >(null);
  // ConversationView 暴露的 chat.regenerate — VgMessageExtras "重新生成" 用
  const regenerateRef = React.useRef<(() => void) | null>(null);

  // ── 顶部导航跳转 ─────────────────────────────────────────────
  const goBatch = React.useCallback(() => {
    openTab('/video-generation/batch', { title: '批量生成', icon: 'layers' });
    void navigate({ to: '/video-generation/batch' as never });
  }, [openTab, navigate]);
  const goTimeline = React.useCallback(() => {
    openTab('/video-generation/timeline', { title: '视频编辑', icon: 'film' });
    void navigate({ to: '/video-generation/timeline' as never });
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

  // 用户点"去生成视频"→ 先门控，通过后提交任务，写回 metadata。
  const onSubmit = React.useCallback(
    async (messageId: string) => {
      const setMessages = setMessagesRef.current;
      if (!setMessages) return;
      let snapshot: ChatMessage | undefined;
      let subject = '';
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        snapshot = idx >= 0 ? prev[idx] : undefined;
        for (let i = idx - 1; i >= 0; i -= 1) {
          if (prev[i]?.role === 'user') { subject = (prev[i]?.content || '').trim(); break; }
        }
        return prev;
      });
      if (!snapshot) return;

      // 门控（一次视频额度）
      await gate.guard(async () => {
        const script = (snapshot!.content ?? '').trim();
        const base = useVgComposer.getState().params;
        const params = {
          ...base,
          video_subject: base.video_subject || subject,
          video_script: script || base.video_script,
          script_source: 'manual' as const,
          model: resolveVgChatModel() || base.model || undefined,
          voice_provider: base.voice_provider,
          voice_name: base.voice_name,
          voice_rate: base.voice_rate,
          voice_volume: base.voice_volume,
          bgm_type: base.bgm_type,
          bgm_file: base.bgm_file,
          bgm_volume: base.bgm_volume,
          video_aspect: base.video_aspect,
          video_width: base.video_width,
          video_height: base.video_height,
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
      });
    },
    [gate],
  );

  // ── 自定义 buildRequest:把 mode 钉死 video_generation ─────────
  const buildRequest = React.useCallback<
    NonNullable<React.ComponentProps<typeof ConversationView>['buildRequest']>
  >(
    ({ messages, query }) => {
      const composer = vgComposerStore.getState();
      const req = buildChatRequest(query, messages, composer);
      const p = useVgComposer.getState().params;
      return {
        ...req,
        mode: 'video_generation',
        metadata: {
          videoGeneration: {
            language: p.video_language,
            paragraphNumber: p.paragraph_number,
            aspect: p.video_aspect,
            model: req.model,
          },
        },
      };
    },
    [],
  );

  // ── 全自动模式拦截（含门控）───────────────────────────────────────────────
  const onBeforeSend = React.useCallback(
    async (text: string): Promise<boolean> => {
      if (!autoMode) return false;
      const subj = text.trim();
      if (!subj) return false;

      // 全自动模式先门控
      await gate.guard(async () => {
        const params = {
          ...useVgComposer.getState().params,
          video_subject: subj,
          script_source: 'ai' as const,
          model: resolveVgChatModel() || undefined,
        };
        try {
          const t = await videoGeneration.submitTask(params, { stop_at: 'video' });
          notifySuccess(
            `已提交全自动任务 ${t.task_id.slice(0, 8)}…`,
            '前往"我的视频"看实时进度',
          );
          setTimeout(goLibrary, 800);
        } catch (e) {
          reportError(e as Error, '全自动提交失败');
        }
      });
      return true; // skip chat path
    },
    [autoMode, goLibrary, gate],
  );

  // ── 顶部 header ──────────────────────────────────────────────────────────
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
          onClick={goTimeline}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
        >
          <Film className="h-3 w-3" /> 时间轴
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

  const composerTop = (
    <VgComposerToolbar autoMode={autoMode} onAutoModeChange={setAutoMode} />
  );

  return (
    <ComposerStoreContext.Provider value={vgComposerStore}>
      {/* 按次门控弹层 */}
      <UsageGateDialogs app="video" gate={gate} />
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
            regenerateRef={regenerateRef}
            composerTopSlot={composerTop}
            modelPillProps={{ chatOnly: true }}
            assistantEditable
            onAssistantEdit={(id, content) =>
              setMessagesRef.current?.((prev) =>
                prev.map((m) => (m.id === id ? { ...m, content } : m)),
              )
            }
            extraSlot={(m) => (
              <VgMessageExtras
                message={m}
                onMetaChange={onMetaChange}
                onSubmit={onSubmit}
                onRegenerate={() => regenerateRef.current?.()}
                onGoEdit={(script) => {
                  const st = useVgComposer.getState();
                  st.setScriptSlot('manual', script);
                  st.setScriptSource('manual');
                  st.resetDraft();
                  goTimeline();
                }}
              />
            )}
          />
        </div>
      </div>
    </ComposerStoreContext.Provider>
  );
};

export default VgChatPage;

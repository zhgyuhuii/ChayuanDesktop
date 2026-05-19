/**
 * 模态路由提交 hook —— 非聊天 capability(t2i/t2v/tts/image_edit 等)的对话提交链路。
 *
 * 与 `useChayuanChat` 的关系:
 *   - 共享同一个 `setMessages`(传入),所以消息列表统一,不分两条 store
 *   - `isStreaming` 独立,父级用 `chat.isStreaming || modality.isStreaming` 给 ChatComposer
 *   - 失败/取消语义独立(t2i 的"取消"是 AbortController,chat 是 EventSource close)
 *
 * 事件 → 消息 part 映射:
 *   v5 `start`            → 创建 assistant 消息(streaming=true)
 *   v5 `text-delta`       → assistant.content += delta
 *   v5 `file`             → assistant.files.push({mediaType, url, metadata})
 *   v5 `source-*`         → assistant.citations.push(...)(暂未接,留 PR-5)
 *   v5 `data-task-progress` → 暂展示在 assistant.content 末尾(简单显示;
 *                            PR-4 引入独立 progress part 后剥离)
 *   v5 `error`            → assistant.error = errorText;streaming=false
 *   v5 `finish`           → streaming=false
 *
 * 注意:**只**处理非 chat capability。chat 模型继续走 useChayuanChat。
 */

import * as React from 'react';
import { uuid } from '@chayuan/platform-shared';
import {
  classifyModalityCapability,
  streamModality,
  type V5Event,
  isFilePart,
  isTextDelta,
  isDataPart,
  isErrorEvent,
} from '@chayuan/transport';
import type { ChatMessage, ModalityFileAttachment } from './useChayuanChat';

export interface UseModalitySubmitOptions {
  /** 共用 useChayuanChat.setMessages */
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /** 后端 API base — chayuan-server 单机版固定 ``http://127.0.0.1:62581`` */
  baseUrl: string;
  /** 鉴权头 — 可选,跟随老 transport 一致 */
  authHeader?: string;
  /** 出错时上报(reportError 等)— 可选 */
  onError?(message: string): void;
}

export interface UseModalitySubmitReturn {
  /** 当前是否在流式生成 */
  isStreaming: boolean;
  /** 中止当前生成 — 内部 AbortController.abort() */
  stop(): void;
  /**
   * 判断给定 modelId 是否应走本 hook(capability 非 chat 且非 vl)。
   * vl 走老 chat 路径(content 数组)。
   */
  shouldHandle(modelId: string | null | undefined): boolean;
  /** 执行一次提交;前置:shouldHandle(modelId) === true */
  run(input: {
    text: string;
    modelId: string;
    params?: Record<string, unknown>;
  }): Promise<void>;
}

export function useModalitySubmit(opts: UseModalitySubmitOptions): UseModalitySubmitReturn {
  const { setMessages, baseUrl, authHeader, onError } = opts;
  const [isStreaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const shouldHandle = React.useCallback((modelId: string | null | undefined): boolean => {
    const cap = classifyModalityCapability(modelId);
    // chat / vl 走老 chat 链路(VL 用多模态 content list,老 chat 支持)
    return cap !== 'chat' && cap !== 'vl';
  }, []);

  const run = React.useCallback(
    async (input: { text: string; modelId: string; params?: Record<string, unknown> }) => {
      const text = input.text.trim();
      if (!text) return;
      const now = Date.now();

      // 1. 推 user + assistant 占位
      const userMsg: ChatMessage = {
        id: uuid(),
        role: 'user',
        content: text,
        createdAt: now,
      };
      const asstId = uuid();
      const asstMsg: ChatMessage = {
        id: asstId,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
        streaming: true,
        files: [],
      };
      setMessages((prev) => [...prev, userMsg, asstMsg]);

      // 2. 启动 SSE 流
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);

      // 局部辅助:对 assistant 消息做不可变更新
      const patchAsst = (mutator: (m: ChatMessage) => ChatMessage) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === asstId ? mutator(m) : m)),
        );
      };

      try {
        const stream = streamModality(
          {
            model: input.modelId,
            prompt: text,
            params: input.params,
            baseUrl,
            authHeader,
          },
          ctrl.signal,
        );

        for await (const ev of stream as AsyncGenerator<V5Event>) {
          if (ctrl.signal.aborted) break;

          if (isTextDelta(ev)) {
            patchAsst((m) => ({ ...m, content: m.content + ev.delta }));
            continue;
          }
          if (isFilePart(ev)) {
            const attachment: ModalityFileAttachment = {
              mediaType: ev.mediaType,
              url: ev.url,
              metadata: ev.metadata,
            };
            patchAsst((m) => ({ ...m, files: [...(m.files ?? []), attachment] }));
            continue;
          }
          if (isErrorEvent(ev)) {
            patchAsst((m) => ({ ...m, error: ev.errorText, streaming: false }));
            onError?.(ev.errorText);
            continue;
          }
          if (isDataPart(ev) && ev.type === 'data-task-progress') {
            // 写入独立的 taskProgress 字段,MessageBubble 渲染进度条;
            // 不再污染 content(早期 PR-3 是用 content 当兜底)。
            const data = ev.data as
              | { percent?: number; message?: string; eta_s?: number; task_id?: string }
              | null;
            if (data) {
              patchAsst((m) => ({
                ...m,
                taskProgress: {
                  percent: Math.max(0, Math.min(100, data.percent ?? 0)),
                  message: data.message,
                  eta_s: data.eta_s,
                  task_id: data.task_id,
                },
              }));
            }
            continue;
          }
          // 其它事件(start / finish / source-* / usage 等)不影响渲染,忽略
        }
      } catch (e) {
        // 用户取消 → AbortError 不算错误
        if ((e as Error)?.name === 'AbortError') {
          patchAsst((m) => ({ ...m, streaming: false }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          patchAsst((m) => ({ ...m, error: msg, streaming: false }));
          onError?.(msg);
        }
      } finally {
        // 流正常 / 异常都要清 streaming 状态
        patchAsst((m) => ({ ...m, streaming: false }));
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [setMessages, baseUrl, authHeader, onError],
  );

  return { isStreaming, stop, shouldHandle, run };
}

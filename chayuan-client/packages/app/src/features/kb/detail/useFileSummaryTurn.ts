import * as React from 'react';
import { uuid } from '@chayuan/platform-shared';
import { subscribeFileSummary, type FileSummaryFrame } from '@chayuan/api';
import type { ChatMessage } from '../../chat/useChayuanChat';
import { upsertConversation, appendMessage } from '../../conversations/persistence';
import { applySummaryFrame } from './fileSummaryReducer';

type SetMessages = React.Dispatch<React.SetStateAction<ChatMessage[]>>;

export interface UseFileSummaryTurnOptions {
  kbName: string;
  modelId: string;
  localUserId: string;
  /** 父级当前会话 id(可变 ref);hook 会在新建会话时就地写入 */
  convIdRef: React.MutableRefObject<string | null>;
  /** ConversationView 暴露的 setMessages */
  setMessagesRef: React.MutableRefObject<SetMessages | null>;
  /** 新建会话后回调:父级 setConvId + 切 chat 模式 */
  onConversationCreated: (id: string) => void;
}

export interface UseFileSummaryTurnReturn {
  startSummary: (fileName: string) => Promise<void>;
  confirmSummary: (assistantId: string) => void;
  cancelSummary: (assistantId: string) => void;
  retrySummary: (assistantId: string) => void;
}

interface Pair { fileName: string; userMsg: ChatMessage; createdAt: number; }

export function useFileSummaryTurn(opts: UseFileSummaryTurnOptions): UseFileSummaryTurnReturn {
  const { kbName, modelId, localUserId, convIdRef, setMessagesRef, onConversationCreated } = opts;
  const unsubRef = React.useRef<Map<string, () => void>>(new Map());
  const typeRef = React.useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const pairRef = React.useRef<Map<string, Pair>>(new Map());

  const patch = React.useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessagesRef.current?.((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, [setMessagesRef]);

  const stopType = React.useCallback((id: string) => {
    const t = typeRef.current.get(id);
    if (t) { clearInterval(t); typeRef.current.delete(id); }
  }, []);

  const persist = React.useCallback((assistantId: string, fullSummary: string) => {
    const convId = convIdRef.current;
    const pair = pairRef.current.get(assistantId);
    if (!convId || !pair) return;
    const asst: ChatMessage = {
      id: assistantId, role: 'assistant', content: fullSummary, createdAt: pair.createdAt + 1,
      metadata: { summary: { state: 'ok', fileName: pair.fileName } },
    };
    void appendMessage(convId, pair.userMsg, localUserId);
    void appendMessage(convId, asst, localUserId);
  }, [convIdRef, localUserId]);

  const subscribe = React.useCallback((assistantId: string, fileName: string, confirmed: boolean) => {
    unsubRef.current.get(assistantId)?.();
    patch(assistantId, (m) => ({
      ...m, streaming: true, content: '', error: undefined,
      taskProgress: { percent: 0, message: '正在通览整篇并归纳…' },
      metadata: { ...(m.metadata ?? {}), summary: { state: 'running', fileName } },
    }));
    const unsub = subscribeFileSummary(
      { knowledge_base_name: kbName, file_name: fileName, confirmed, model_name: modelId || undefined },
      (f: FileSummaryFrame) => {
        patch(assistantId, (m) => applySummaryFrame(m, f, fileName));
        if (f.status === 'ok') {
          // 正文已由 applySummaryFrame('ok') 用 summary 落定(流式时即增量拼接的权威覆盖)
          unsubRef.current.delete(assistantId);
          persist(assistantId, f.summary);
        } else if (f.status === 'error') {
          unsubRef.current.delete(assistantId);
        }
      },
      (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        patch(assistantId, (m) => applySummaryFrame(m, { status: 'error', msg }, fileName));
        unsubRef.current.delete(assistantId);
      },
    );
    unsubRef.current.set(assistantId, unsub);
  }, [kbName, modelId, patch, persist]);

  const startSummary = React.useCallback(async (fileName: string) => {
    const setMessages = setMessagesRef.current;
    if (!setMessages) return;
    const now = Date.now();
    let convId = convIdRef.current;
    const created = !convId;
    if (created) {
      convId = uuid();
      await upsertConversation({
        id: convId, user_id: localUserId, remote_id: convId,
        title: `总结《${fileName}》`, model: modelId, mode: 'kb',
        created_at: now, updated_at: now,
      });
      convIdRef.current = convId;
    }
    const assistantId = uuid();
    const userMsg: ChatMessage = { id: uuid(), role: 'user', content: `请整篇总结《${fileName}》`, createdAt: now };
    const asstMsg: ChatMessage = {
      id: assistantId, role: 'assistant', content: '', createdAt: now + 1, streaming: true,
      taskProgress: { percent: 0, message: '正在通览整篇并归纳…' },
      metadata: { summary: { state: 'running', fileName } },
    };
    setMessages((prev) => [...prev, userMsg, asstMsg]);
    pairRef.current.set(assistantId, { fileName, userMsg, createdAt: now });
    subscribe(assistantId, fileName, false);
    if (created) onConversationCreated(convId!);
  }, [convIdRef, localUserId, modelId, onConversationCreated, setMessagesRef, subscribe]);

  const confirmSummary = React.useCallback((assistantId: string) => {
    const pair = pairRef.current.get(assistantId);
    if (pair) subscribe(assistantId, pair.fileName, true);
  }, [subscribe]);

  const retrySummary = React.useCallback((assistantId: string) => {
    const pair = pairRef.current.get(assistantId);
    if (pair) subscribe(assistantId, pair.fileName, false);
  }, [subscribe]);

  const cancelSummary = React.useCallback((assistantId: string) => {
    unsubRef.current.get(assistantId)?.();
    unsubRef.current.delete(assistantId);
    stopType(assistantId);
    const fileName = pairRef.current.get(assistantId)?.fileName ?? '';
    patch(assistantId, (m) => ({
      ...m, streaming: false, taskProgress: undefined,
      metadata: { ...(m.metadata ?? {}), summary: { state: 'error', fileName, msg: '已取消' } },
    }));
  }, [patch, stopType]);

  React.useEffect(() => {
    const unsubs = unsubRef.current; const types = typeRef.current;
    return () => {
      unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
      unsubs.clear();
      types.forEach((t) => clearInterval(t));
      types.clear();
    };
  }, []);

  return { startSummary, confirmSummary, cancelSummary, retrySummary };
}

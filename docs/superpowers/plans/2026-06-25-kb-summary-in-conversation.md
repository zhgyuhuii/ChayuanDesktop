# 知识库「全文总结」改为对话内进行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「全文总结」从独立弹窗改为对话内一轮交互:进度条 → 可取消 → 打字机流式输出总结正文 → 落入对话历史;图标 + 自然语言统一入口;后台去掉入口;后端零改动。

**Architecture:** 复用 VgChatPage 已上线的「父级编排 + setMessagesRef/extraSlot」模式。KbDetailPage 持 `setMessagesRef`,新增 `useFileSummaryTurn` hook 编排一轮总结的生命周期(建会话 / 注入消息 / 订阅已修复的 `subscribeFileSummary` SSE / 打字机 / 落库 / 取消),帧→消息状态迁移抽成纯函数 `applySummaryFrame` 做 TDD 核心。删除 `FileSummaryDialog`。

**Tech Stack:** React + TypeScript;@chayuan/api(`subscribeFileSummary`)、@chayuan/transport(消息元数据类型)、@chayuan/ui;vitest 单测。

---

## File Structure

- `packages/transport/src/types.ts` — 新增 `SummaryMessageMeta`(与 `VgMessageMeta` 同处)
- `packages/app/src/features/chat/useChayuanChat.ts` — `ChatMessage.metadata` 加 `summary?` 字段
- `packages/app/src/features/kb/detail/fileSummaryReducer.ts` — 新建:纯函数 `applySummaryFrame`(帧→消息状态)
- `packages/app/src/features/kb/detail/fileSummaryReducer.test.ts` — 新建:reducer 单测
- `packages/app/src/features/kb/detail/useFileSummaryTurn.ts` — 新建:编排 hook
- `packages/app/src/features/kb/detail/FileSummaryMessageExtras.tsx` — 新建:extraSlot 渲染(进度/确认/取消/重试)
- `packages/app/src/features/kb/detail/DocumentKbDetail.tsx` — 改:加 `onSummarizeFile` prop、图标按 prop 显隐、删 FileSummaryDialog 引用与 `summaryFile` 状态
- `packages/app/src/features/kb/detail/KbDetailPage.tsx` — 改:接 `setMessagesRef`/`extraSlot`/`useFileSummaryTurn`,`onBeforeSend` 改走 startSummary,给 DocumentKbDetail 传 `onSummarizeFile`,删 FileSummaryDialog
- `packages/app/src/features/kb/detail/FileSummaryDialog.tsx` — 删除

仓库根目录是 root 拥有:所有文件改动用 `sudo`(读写都要)。提交分支 `main`,push `origin/main`(本仓约定)。

---

## 关键不变量(实现时务必遵守)

1. **注入顺序**:startSummary 必须 **先 `setMessages` 注入用户/助手气泡,再 `onConversationCreated`(setConvId)**。ConversationView 的加载 effect 在 `conversationId` 由 null→新 id 时会 `listMessages`,其守卫是「内存有消息且 DB 为空则不覆盖」(ConversationView.tsx:285)。顺序错了会被空 DB 覆盖掉注入的消息。
2. **convIdRef 立即写**:hook 拿到/新建 convId 后立刻 `convIdRef.current = convId`,不依赖 KbDetailPage 的同步 effect,避免 ok 帧落库时 convId 还是 null。
3. **后端零改动**:总结正文「流式」用前端打字机(逐字 setMessages),不改后端;后端 `ok` 帧仍是一次性整篇。

---

### Task 1: 新增 SummaryMessageMeta 类型并接入 ChatMessage

**Files:**
- Modify: `packages/transport/src/types.ts`(在 `export interface VgMessageMeta` 附近)
- Modify: `packages/app/src/features/chat/useChayuanChat.ts:32`(import)与 `:127`(metadata 字段)

- [ ] **Step 1: 在 transport 加类型**

在 `packages/transport/src/types.ts` 的 `VgMessageMeta` 定义之后新增:

```ts
export interface SummaryMessageMeta {
  state: 'running' | 'needs_confirm' | 'ok' | 'error';
  fileName: string;
  chunkCount?: number;
  estCalls?: number;
  msg?: string;
}
```

- [ ] **Step 2: useChayuanChat 引入并接到 metadata**

`packages/app/src/features/chat/useChayuanChat.ts` 的 transport import 块(第 32 行 `type VgMessageMeta,` 同组)加一行:

```ts
  type SummaryMessageMeta,
```

把 `ChatMessage.metadata` 字段(第 127 行)改为:

```ts
  metadata?: { videoMeta?: VgMessageMeta; summary?: SummaryMessageMeta; [k: string]: unknown };
```

- [ ] **Step 3: 类型检查**

Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
Expected: PASS(全部包 Done,exit 0)

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-client/packages/transport/src/types.ts chayuan-client/packages/app/src/features/chat/useChayuanChat.ts && sudo git commit -m "feat(kb): ChatMessage.metadata 增加 summary 元数据类型"
```

---

### Task 2: 纯函数 applySummaryFrame(帧→消息状态)+ 单测(TDD)

**Files:**
- Create: `packages/app/src/features/kb/detail/fileSummaryReducer.ts`
- Test: `packages/app/src/features/kb/detail/fileSummaryReducer.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/app/src/features/kb/detail/fileSummaryReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applySummaryFrame } from './fileSummaryReducer';
import type { ChatMessage } from '../../chat/useChayuanChat';

const base: ChatMessage = { id: 'a1', role: 'assistant', content: '', createdAt: 0 };

describe('applySummaryFrame', () => {
  it('progress 帧 → 进度百分比 + running 态', () => {
    const m = applySummaryFrame(base, { status: 'progress', done: 3, total: 6 }, 'x.docx');
    expect(m.taskProgress?.percent).toBe(50);
    expect(m.streaming).toBe(true);
    expect(m.metadata?.summary).toEqual({ state: 'running', fileName: 'x.docx' });
  });

  it('needs_confirm 帧 → 停流 + 带 chunkCount/estCalls', () => {
    const m = applySummaryFrame(base, { status: 'needs_confirm', chunk_count: 80, est_llm_calls: 17 }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.metadata?.summary).toEqual({ state: 'needs_confirm', fileName: 'x.docx', chunkCount: 80, estCalls: 17 });
  });

  it('ok 帧 → 停流 + 100% + ok 态(content 由打字机负责,不在此设)', () => {
    const m = applySummaryFrame({ ...base, content: '部分' }, { status: 'ok', summary: '完整总结' }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.taskProgress?.percent).toBe(100);
    expect(m.metadata?.summary?.state).toBe('ok');
  });

  it('error 帧 → 停流 + error 文案', () => {
    const m = applySummaryFrame(base, { status: 'error', msg: '炸了' }, 'x.docx');
    expect(m.streaming).toBe(false);
    expect(m.error).toBe('炸了');
    expect(m.metadata?.summary).toEqual({ state: 'error', fileName: 'x.docx', msg: '炸了' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/chayuan-desktop/chayuan-client && npx vitest run packages/app/src/features/kb/detail/fileSummaryReducer.test.ts`
Expected: FAIL(`applySummaryFrame` 未定义 / 模块不存在)

- [ ] **Step 3: 实现 reducer**

`packages/app/src/features/kb/detail/fileSummaryReducer.ts`:

```ts
import type { SummaryMessageMeta } from '@chayuan/transport';
import type { ChatMessage } from '../../chat/useChayuanChat';
import type { FileSummaryFrame } from '@chayuan/api';

/**
 * 纯函数:把一帧 FileSummaryFrame 应用到当前 assistant 消息,得到下一态。
 * content 不在此设——`ok` 时正文由 useFileSummaryTurn 的打字机逐字写入。
 */
export function applySummaryFrame(
  msg: ChatMessage,
  frame: FileSummaryFrame,
  fileName: string,
): ChatMessage {
  const withSummary = (s: Omit<SummaryMessageMeta, 'fileName'>): ChatMessage['metadata'] =>
    ({ ...(msg.metadata ?? {}), summary: { ...s, fileName } });

  switch (frame.status) {
    case 'running':
      return {
        ...msg, streaming: true, error: undefined,
        taskProgress: { percent: frame.total ? 1 : 0, message: '正在通览整篇并归纳…' },
        metadata: withSummary({ state: 'running' }),
      };
    case 'progress': {
      const percent = frame.total ? Math.min(99, Math.round((frame.done / frame.total) * 100)) : 0;
      return {
        ...msg, streaming: true,
        taskProgress: { percent, message: '正在归纳…' },
        metadata: withSummary({ state: 'running' }),
      };
    }
    case 'needs_confirm':
      return {
        ...msg, streaming: false, taskProgress: undefined,
        metadata: withSummary({ state: 'needs_confirm', chunkCount: frame.chunk_count, estCalls: frame.est_llm_calls }),
      };
    case 'ok':
      return {
        ...msg, streaming: false, error: undefined,
        taskProgress: { percent: 100 },
        metadata: withSummary({ state: 'ok' }),
      };
    case 'error':
      return {
        ...msg, streaming: false, taskProgress: undefined, error: frame.msg,
        metadata: withSummary({ state: 'error', msg: frame.msg }),
      };
    default:
      return msg;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /work/chayuan-desktop/chayuan-client && npx vitest run packages/app/src/features/kb/detail/fileSummaryReducer.test.ts`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-client/packages/app/src/features/kb/detail/fileSummaryReducer.ts chayuan-client/packages/app/src/features/kb/detail/fileSummaryReducer.test.ts && sudo git commit -m "feat(kb): 全文总结 帧→消息状态 纯函数 applySummaryFrame + 单测"
```

---

### Task 3: 编排 hook useFileSummaryTurn

**Files:**
- Create: `packages/app/src/features/kb/detail/useFileSummaryTurn.ts`

- [ ] **Step 1: 实现 hook**

`packages/app/src/features/kb/detail/useFileSummaryTurn.ts`:

```ts
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

const TYPE_TICK_MS = 16;

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

  const typewriter = React.useCallback((id: string, full: string) => {
    stopType(id);
    const step = Math.max(2, Math.ceil(full.length / 120));
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(full.length, i + step);
      patch(id, (m) => ({ ...m, content: full.slice(0, i) }));
      if (i >= full.length) stopType(id);
    }, TYPE_TICK_MS);
    typeRef.current.set(id, timer);
  }, [patch, stopType]);

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
    // 旧订阅先收掉(retry/confirm 复用同一气泡)
    unsubRef.current.get(assistantId)?.();
    patch(assistantId, (m) => ({
      ...m, streaming: true, content: '', error: undefined,
      taskProgress: { percent: 0, message: '正在通览整篇并归纳…' },
      metadata: { ...(m.metadata ?? {}), summary: { state: 'running', fileName } },
    }));
    const unsub = subscribeFileSummary(
      { knowledge_base_name: kbName, file_name: fileName, confirmed },
      (f: FileSummaryFrame) => {
        patch(assistantId, (m) => applySummaryFrame(m, f, fileName));
        if (f.status === 'ok') {
          unsubRef.current.delete(assistantId);
          typewriter(assistantId, f.summary);
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
  }, [kbName, patch, persist, typewriter]);

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
      convIdRef.current = convId; // 立即写,避免 ok 帧落库时还是 null
    }
    const assistantId = uuid();
    const userMsg: ChatMessage = { id: uuid(), role: 'user', content: `请整篇总结《${fileName}》`, createdAt: now };
    const asstMsg: ChatMessage = {
      id: assistantId, role: 'assistant', content: '', createdAt: now + 1, streaming: true,
      taskProgress: { percent: 0, message: '正在通览整篇并归纳…' },
      metadata: { summary: { state: 'running', fileName } },
    };
    // 关键顺序:先注入消息,再 setConvId(否则加载 effect 用空 DB 覆盖)
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
```

- [ ] **Step 2: 类型检查**

Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-client/packages/app/src/features/kb/detail/useFileSummaryTurn.ts && sudo git commit -m "feat(kb): useFileSummaryTurn 编排对话内全文总结(建会话/注入/订阅/打字机/落库/取消)"
```

---

### Task 4: extraSlot 渲染组件 FileSummaryMessageExtras

**Files:**
- Create: `packages/app/src/features/kb/detail/FileSummaryMessageExtras.tsx`

- [ ] **Step 1: 实现组件**

`packages/app/src/features/kb/detail/FileSummaryMessageExtras.tsx`:

```tsx
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { TaskProgressPart } from '../../chat/parts/TaskProgressPart';
import type { ChatMessage } from '../../chat/useChayuanChat';

export interface FileSummaryMessageExtrasProps {
  message: ChatMessage;
  onConfirm: (assistantId: string) => void;
  onCancel: (assistantId: string) => void;
  onRetry: (assistantId: string) => void;
}

/** 走 ConversationView 的 extraSlot:按 metadata.summary.state 渲染进度/确认/重试。 */
export const FileSummaryMessageExtras: React.FC<FileSummaryMessageExtrasProps> = ({
  message, onConfirm, onCancel, onRetry,
}) => {
  const summary = message.metadata?.summary;
  if (!summary) return null;

  if (summary.state === 'running') {
    return (
      <div className="mt-1 flex flex-col gap-1.5">
        {message.taskProgress && (
          <TaskProgressPart
            percent={message.taskProgress.percent}
            message={message.taskProgress.message}
          />
        )}
        <div>
          <Button size="sm" variant="outline" onClick={() => onCancel(message.id)}>取消</Button>
        </div>
      </div>
    );
  }

  if (summary.state === 'needs_confirm') {
    return (
      <div className="mt-1 flex flex-col gap-2 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm">
        <span>
          该文件较大(约 <b>{summary.chunkCount}</b> 块),整篇总结预计约
          <b> {summary.estCalls} </b>次模型调用,可能耗时较久。
        </span>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onConfirm(message.id)}>仍然总结</Button>
          <Button size="sm" variant="outline" onClick={() => onCancel(message.id)}>取消</Button>
        </div>
      </div>
    );
  }

  if (summary.state === 'error') {
    return (
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="text-destructive">总结失败:{summary.msg}</span>
        <Button size="sm" variant="outline" onClick={() => onRetry(message.id)}>重试</Button>
      </div>
    );
  }

  return null; // ok:正文即 message.content,无额外
};
```

- [ ] **Step 2: 类型检查**

Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-client/packages/app/src/features/kb/detail/FileSummaryMessageExtras.tsx && sudo git commit -m "feat(kb): FileSummaryMessageExtras 对话内进度条/二次确认/重试"
```

---

### Task 5: DocumentKbDetail —— 图标改上抛回调、按 prop 显隐、删 FileSummaryDialog 引用

**Files:**
- Modify: `packages/app/src/features/kb/detail/DocumentKbDetail.tsx`

- [ ] **Step 1: 组件 props 加 onSummarizeFile**

找到 `export const DocumentKbDetail: React.FC<DetailPanelProps<KuDocumentDetail> & {` 这一处类型交集,在其中加:

```ts
  onSummarizeFile?: (fileName: string) => void;
```

并在解构 props 处加入 `onSummarizeFile`。

- [ ] **Step 2: 删除 FileSummaryDialog 相关**

删除以下三处:
- 第 34 行 import:`import { FileSummaryDialog } from './FileSummaryDialog';`
- 第 65 行 state:`const [summaryFile, setSummaryFile] = React.useState<string | null>(null);`
- 第 317-322 行渲染块:整个 `<FileSummaryDialog ... />`

- [ ] **Step 3: FileRow 调用处改为走回调(第 376-389 行的 `<FileRow .../>`)**

把 `onSummarize={() => setSummaryFile(f.file_name)}` 改为:

```tsx
                  onSummarize={onSummarizeFile ? () => onSummarizeFile(f.file_name) : undefined}
```

- [ ] **Step 4: FileRow 类型与图标按 prop 显隐**

`FileRow` 的 props 类型里把 `onSummarize(): void;` 改为可选:

```ts
  onSummarize?: () => void;
```

解构处 `onSummarize` 保持。把总结图标按钮(第 641-649 行 `<button ... onClick={onSummarize} aria-label="总结全文" ...>`)整段用条件包裹,仅在有回调时渲染:

```tsx
        {onSummarize && (
          <button
            type="button"
            onClick={onSummarize}
            aria-label="总结全文"
            className={cn('mx-0.5 rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]')}
            title="总结全文(站在整篇归纳)"
          >
            <ScrollText className="h-3.5 w-3.5" />
          </button>
        )}
```

- [ ] **Step 5: 类型检查**

Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
Expected: PASS(此刻 FileSummaryDialog 已无引用,但文件还在,不报错)

- [ ] **Step 6: Commit**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-client/packages/app/src/features/kb/detail/DocumentKbDetail.tsx && sudo git commit -m "feat(kb): 文件列表总结图标改上抛 onSummarizeFile,按 prop 显隐;移除弹窗引用"
```

---

### Task 6: KbDetailPage 接线(setMessagesRef / extraSlot / hook / onBeforeSend / 给 DocumentKbDetail 传回调)

**Files:**
- Modify: `packages/app/src/features/kb/detail/KbDetailPage.tsx`

- [ ] **Step 1: import 调整**

删除:`import { FileSummaryDialog } from './FileSummaryDialog';`
新增:

```ts
import { useFileSummaryTurn } from './useFileSummaryTurn';
import { FileSummaryMessageExtras } from './FileSummaryMessageExtras';
import { useLocalUserId } from '../../conversations/localUser';
import type { ChatMessage } from '../../chat/useChayuanChat';
```

- [ ] **Step 2: 增加 refs / 依赖,装配 hook**

在组件内(`convId` 状态附近)加:

```tsx
  const modelId = useComposerStore((s) => s.modelId);
  const localUserId = useLocalUserId();
  const convIdRef = React.useRef<string | null>(convId);
  React.useEffect(() => { convIdRef.current = convId; }, [convId]);
  const setMessagesRef = React.useRef<React.Dispatch<React.SetStateAction<ChatMessage[]>> | null>(null);

  const summaryKb = detailQ.data?.kind === 'document' ? detailQ.data.meta.name : '';
  const summaryTurn = useFileSummaryTurn({
    kbName: summaryKb,
    modelId,
    localUserId,
    convIdRef,
    setMessagesRef,
    onConversationCreated: (id) => {
      setConvId(id);
      setChatCollapsed(false);
      writeChatCollapsedLS(kuId, false);
    },
  });
```

(注:`useComposerStore` 已在本文件 import;若文件内用的是别名 `useComposerS`,沿用该别名。)

- [ ] **Step 3: onBeforeSend 改走 startSummary**

把现有 `onBeforeSend`(第 152-163 行)体内命中分支由「setSummaryFile」改为:

```tsx
      const hit = detectSummarizeIntent(text, names);
      if (hit) {
        await summaryTurn.startSummary(hit.fileName);
        return true;
      }
      return false;
```

并把 `summaryTurn` 加入该 useCallback 依赖数组。删除 `summaryFile`/`setSummaryFile` 相关 state(第 143 行)。

- [ ] **Step 4: 给 DocumentKbDetail 传 onSummarizeFile(第 302-306 行)**

```tsx
                  <DocumentKbDetail
                    detail={detail}
                    mine={canWrite}
                    onMutate={onMutate}
                    onToggleCollapse={toggleBody}
                    onSummarizeFile={(f) => { void summaryTurn.startSummary(f); }}
                  />
```

- [ ] **Step 5: ConversationView 接 setMessagesRef + extraSlot(第 320-332 行 `<ConversationView ...>`)**

在该元素属性中加:

```tsx
                  setMessagesRef={setMessagesRef}
                  extraSlot={(m) =>
                    m.metadata?.summary ? (
                      <FileSummaryMessageExtras
                        message={m}
                        onConfirm={summaryTurn.confirmSummary}
                        onCancel={summaryTurn.cancelSummary}
                        onRetry={summaryTurn.retrySummary}
                      />
                    ) : null
                  }
```

删除文件内残留的 `<FileSummaryDialog .../>` 渲染(若有)。

- [ ] **Step 6: 类型检查**

Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-client/packages/app/src/features/kb/detail/KbDetailPage.tsx && sudo git commit -m "feat(kb): KbDetailPage 接入对话内全文总结(setMessagesRef/extraSlot/hook,NL+图标统一入口)"
```

---

### Task 7: 删除 FileSummaryDialog + 全量校验

**Files:**
- Delete: `packages/app/src/features/kb/detail/FileSummaryDialog.tsx`

- [ ] **Step 1: 确认全系统无引用**

Run: `cd /work/chayuan-desktop/chayuan-client && grep -rn "FileSummaryDialog" packages apps --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: 无输出(零引用)

- [ ] **Step 2: 删除文件**

```bash
cd /work/chayuan-desktop && sudo git rm chayuan-client/packages/app/src/features/kb/detail/FileSummaryDialog.tsx
```

- [ ] **Step 3: 测试 + 类型检查**

Run: `cd /work/chayuan-desktop/chayuan-client && npx vitest run packages/app/src/features/kb/detail && npm run typecheck`
Expected: vitest PASS(含 detectSummarizeIntent 旧测 + fileSummaryReducer 新测);typecheck exit 0

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop && sudo git commit -m "chore(kb): 删除已废弃的 FileSummaryDialog(总结已搬进对话)" && sudo git push origin main
```

---

## 验收清单(手动真机,需重建前端)

> 前端改动:网络版需重新构建 `apps/web` 产物并重启前端容器才生效。

1. 文档 KB 文件列表点「总结全文」图标 → 页面切对话模式,出现用户气泡「请整篇总结《xxx》」+ 助手气泡进度条。
2. 对话里输入「xxx 写的是什么 / 总结 xxx」→ 同样进对话总结(不再弹窗)。
3. 进度条跑动;点【取消】→ 停止,气泡转可【重试】。
4. 超大文件 → 气泡内出【仍然总结】【取消】;点仍然总结 → 继续跑。
5. 完成 → 总结正文打字机逐字显现;刷新/重开会话仍在(已落库)。
6. 后台知识库管理(KbAdminDetail)文件列表 → 无总结图标。

## 非目标(YAGNI)

- 流式途中刷新不续接(总结非后端注册任务);已完成的总结正常落库。
- 后台不做对话化结果区。

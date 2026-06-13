# 文生图/图生图 记住对话上下文 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让对话里的文生图(t2i)/图生图(image_edit)带上当前对话上下文:发图前用 chat 模型把「最近 3 轮 + 这次要求」融合成增强 prompt;图生图未传图时自动复用上一张生成图。

**Architecture:** 纯前端(chayuan-client),不动后端。新增 `imagePromptContext.ts`(纯函数 + 改写编排,复用 `aiPlatformChat.complete`);`useModalitySubmit.run` 加 `promptOverride`(显示原话、发送改写);`ConversationView.handleSend` 在模态分支接线。

**Tech Stack:** React + TypeScript,pnpm workspace,zustand,@chayuan/api(`aiPlatformChat`)、@chayuan/transport(`classifyModalityCapability` / `ModalityAttachment`)。

**验证约定:** 前端无 vitest;每任务验证 = `cd chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit`(EXIT=0)+ 手测项。文件 root 所有,编辑/提交走 sudo;分支 main,本任务只 commit 不 push(协调者统一 push)。

---

## 文件结构
- Create: `packages/app/src/features/chat/imagePromptContext.ts` — 取历史 / 组装改写消息 / 调 LLM 改写 / 找上一张生成图(单一职责,隔离可测)。
- Modify: `packages/app/src/features/chat/useModalitySubmit.ts` — `run()` 加可选 `promptOverride`(气泡显示 `text`、发模型用 override)。
- Modify: `packages/app/src/features/chat/ConversationView.tsx` — `handleSend` 模态分支:t2i/image_edit + 有历史 → 改写;image_edit 无图 → 复用上一张图。

---

## Task 1: 新增 imagePromptContext.ts

**Files:**
- Create: `packages/app/src/features/chat/imagePromptContext.ts`

- [ ] **Step 1: 写文件**

内容:
```ts
/**
 * 文生图/图生图「记住对话上下文」辅助。
 *
 * 图像模型只吃一句 prompt(不吃多轮),所以靠:
 *   1) rewriteImagePrompt:用 chat 模型把「最近几轮 + 当前要求」融合成增强 prompt;
 *   2) findLastAssistantImage:图生图未传图时复用上一张生成图。
 * 纯函数(pickHistoryForRewrite / buildRewriteMessages / findLastAssistantImage)
 * 不依赖 React,便于单测。
 */
import { aiPlatformChat, type ChatMessage as ApiChatMessage } from '@chayuan/api';
import type { ChatMessage } from './useChayuanChat';

const MAX_TURNS = 3;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 取最近 maxTurns 轮(user/assistant)的纯文本,忽略流式中/空内容。 */
export function pickHistoryForRewrite(
  messages: ChatMessage[],
  maxTurns = MAX_TURNS,
): HistoryTurn[] {
  const done = messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      !m.streaming &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  );
  return done.slice(-maxTurns * 2).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.trim(),
  }));
}

/** 组装改写用 chat messages。 */
export function buildRewriteMessages(
  history: HistoryTurn[],
  currentText: string,
  mode: 't2i' | 'image_edit',
): ApiChatMessage[] {
  const kind = mode === 'image_edit' ? '图像编辑' : '文生图';
  const sys =
    `你是${kind}提示词专家。根据对话历史和用户的最新一句,产出一句完整、自洽、可直接` +
    `用于图像生成的提示词。要求:\n` +
    `- 补全历史里被指代的对象/风格/修改意图(用户说"再红一点/加只猫"时要带上前文画的是什么)。\n` +
    `- 只输出最终提示词本身,不要解释、不要引号、不要任何前缀。`;
  const histText = history
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');
  const user = `对话历史:\n${histText}\n\n用户最新一句:${currentText}\n\n请输出融合后的完整提示词:`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 找最近一条 assistant 消息里的生成图(图生图复用上一张)。返回 {url, mime} 或 null。 */
export function findLastAssistantImage(
  messages: ChatMessage[],
): { url: string; mime: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.files) continue;
    for (let j = m.files.length - 1; j >= 0; j--) {
      const f = m.files[j];
      if (f.mediaType && f.mediaType.startsWith('image/') && f.url) {
        return { url: f.url, mime: f.mediaType };
      }
    }
  }
  return null;
}

/**
 * 用 chat 模型把历史 + 当前融合成增强 prompt。
 * 无 chatModelId / 无历史 / 调用失败 → 返回 null(调用方回退原 prompt,绝不阻塞生图)。
 */
export async function rewriteImagePrompt(opts: {
  chatModelId: string | null | undefined;
  messages: ChatMessage[];
  currentText: string;
  mode: 't2i' | 'image_edit';
}): Promise<string | null> {
  const { chatModelId, messages, currentText, mode } = opts;
  if (!chatModelId) return null;
  const history = pickHistoryForRewrite(messages);
  if (history.length === 0) return null; // 无历史不改写,省一次调用
  try {
    const resp = await aiPlatformChat.complete({
      model: chatModelId,
      messages: buildRewriteMessages(history, currentText, mode),
      temperature: 0.3,
      max_tokens: 400,
    });
    const out = resp.choices?.[0]?.message?.content?.trim();
    return out && out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(确认 `aiPlatformChat`、`ApiChatMessage`、`ChatMessage.files[].mediaType/url` 类型都对得上;若 ChatMessage 的 files 元素类型字段名不是 `mediaType`/`url`,按真实类型调整 findLastAssistantImage)

- [ ] **Step 3: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/chat/imagePromptContext.ts
sudo git commit -m "feat(chat): 加 imagePromptContext(改写图像prompt+找上一张生成图)"
```

---

## Task 2: useModalitySubmit.run 加 promptOverride

**Files:**
- Modify: `packages/app/src/features/chat/useModalitySubmit.ts`

- [ ] **Step 1: run 签名加 promptOverride,分离 显示 / 发送**

把(useModalitySubmit.ts 约 208-257)的 run 开头到 streamModality 调用:
```ts
  const run = React.useCallback(
    async (input: {
      text: string;
      modelId: string;
      params?: Record<string, unknown>;
      attachments?: ModalityAttachment[];
    }) => {
      const text = input.text.trim();
```
改为:
```ts
  const run = React.useCallback(
    async (input: {
      text: string;
      /** 实际发给模型的 prompt(默认同 text)。用于文生图/图生图把改写后的增强
       *  prompt 发给模型,但气泡仍显示用户原话(text)。 */
      promptOverride?: string;
      modelId: string;
      params?: Record<string, unknown>;
      attachments?: ModalityAttachment[];
    }) => {
      const text = input.text.trim();
      const sentPrompt = (input.promptOverride ?? input.text).trim();
```
并把 streamModality 调用里的 `prompt: text,`(约 250 行)改为 `prompt: sentPrompt,`。

(气泡仍用 `text`:userBubble / `if (!text && !hasAttachments) return;` 保持不变 —— 校验用显示文本即可。)

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 3: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/chat/useModalitySubmit.ts
sudo git commit -m "feat(chat): modalitySubmit.run 加 promptOverride(显示原话/发送改写)"
```

---

## Task 3: ConversationView.handleSend 接线

**Files:**
- Modify: `packages/app/src/features/chat/ConversationView.tsx`

- [ ] **Step 1: 加 imports**

在 ConversationView.tsx 现有 import 区加:
```ts
import { classifyModalityCapability } from '@chayuan/transport';
import {
  pickBestModel,
  useAvailableModelsByCapability,
} from '../home/capabilityCards/useAvailableModelsByCapability';
import {
  rewriteImagePrompt,
  findLastAssistantImage,
} from './imagePromptContext';
```
(若 `classifyModalityCapability` 已从 '@chayuan/transport' 导入过,合并到现有那行,别重复。)

- [ ] **Step 2: 组件内取 chat 模型(hook + ref)**

在 `const messagesRef = React.useRef(chat.messages);` / `messagesRef.current = chat.messages;`(约 206-207)之后加:
```ts
  // 文生图/图生图 prompt 改写要用的 chat 模型(自动挑可用 chat 模型);用 ref 供
  // handleSend 闭包读最新值,避免 stale。
  const { byCap } = useAvailableModelsByCapability();
  const byCapRef = React.useRef(byCap);
  byCapRef.current = byCap;
```

- [ ] **Step 3: handleSend 模态分支接线**

把(约 420-424)的:
```ts
      await modalitySubmit.run({
        // ASR 模式可以空文本;其它模式 text 一定非空(SendButton 已挡)
        text, modelId, params: modalityParams,
        attachments: modalityAttachments.length > 0 ? modalityAttachments : undefined,
      });
```
替换为:
```ts
      // 文生图/图生图:带对话上下文 —— 改写 prompt(显示原话、发送改写)+
      // 图生图未传图时复用上一张生成图。改写失败/无 chat 模型/无历史 → 回退原 prompt。
      const imgCap = classifyModalityCapability(modelId);
      let promptOverride: string | undefined;
      let reusedImage: { mime: string; url: string } | undefined;
      if (imgCap === 't2i' || imgCap === 'image_edit') {
        const chatModelId = pickBestModel(byCapRef.current.get('chat'))?.id ?? null;
        const rewritten = await rewriteImagePrompt({
          chatModelId,
          messages: messagesRef.current,
          currentText: text,
          mode: imgCap,
        });
        if (rewritten) promptOverride = rewritten;
        if (imgCap === 'image_edit' && modalityAttachments.length === 0) {
          const lastImg = findLastAssistantImage(messagesRef.current);
          if (lastImg) reusedImage = lastImg;
        }
      }
      await modalitySubmit.run({
        // ASR 模式可以空文本;其它模式 text 一定非空(SendButton 已挡)
        text, promptOverride, modelId, params: modalityParams,
        attachments:
          modalityAttachments.length > 0
            ? modalityAttachments
            : reusedImage
              ? [{ mime: reusedImage.mime, url: reusedImage.url }]
              : undefined,
      });
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(确认 `byCapRef.current.get('chat')` 返回的桶能被 pickBestModel 接受;确认 run 的 attachments 接受 `{mime,url}`——ModalityAttachment 已支持 url)

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/chat/ConversationView.tsx
sudo git commit -m "feat(chat): 文生图/图生图发图前改写带上下文 + 图生图复用上一张图"
```

手测:
- 文生图连发「画一只猫」→「让它戴顶帽子」,第二张应是戴帽子的猫(承接);
- 图生图不传新图、直接说「把背景换成海边」,应基于上一张生成图改;
- 第一句(无历史)行为不变、不多调用;
- 断网/无 chat 模型时仍能正常生图(回退原 prompt);
- 对话里**显示的用户消息仍是原话**(不是改写后的长 prompt)。

---

## 自检
- spec ① 智能改写(t2i+i2i)→ Task 1(rewriteImagePrompt)+ Task 3 接线 ✓
- spec ② 图生图复用上一张 → Task 1(findLastAssistantImage)+ Task 3 ✓
- 显示原话/发送改写 → Task 2(promptOverride)✓
- 失败回退、无历史不改写、自动选 chat 模型 → rewriteImagePrompt 内 ✓
- 不动后端 ✓

## 风险
- 改写多一次同步 LLM 调用(仅有历史时),增少量延迟;失败已回退。
- `ChatMessage.files` 元素字段名若非 `mediaType`/`url`,Task 1 Step 2 typecheck 会暴露,按真实类型调整。
- 无 chat 模型时不改写(等效现状)。

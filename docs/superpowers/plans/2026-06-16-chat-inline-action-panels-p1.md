# 对话内联产出面板框架 P1(语音合成)Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans。Steps 用 `- [ ]`。

**Goal:** 普通对话产出后,在 assistant 消息下方内联出现「合成语音」面板(可编辑文字+引擎/音色+确定→生成→音频挂消息可下载,刷新还在),LLM 自动判意图触发 + 手动触发。框架可扩展到图像/视频(P2/P3)。

**Architecture:** ConversationView 为 hub(已有 modality 生成 + extraSlot + setMessages)。新增意图识别(LLM,仿 rewriteImagePrompt)+ ACTION_TYPES 注册表 + MessageActionPanel(经 extraSlot 逐条挂)。生成走 streamModality,产物追加到 message.files(复用既有渲染+持久化)。

**Tech Stack:** React/TS;复用 VoicePicker / VerticalSliderPopover / streamModality / aiPlatform chatCompletion / message.files。root-owned→sudo;每 commit bump。

---

## File Structure
- Create `features/chat/messageActions/actionTypes.tsx` — ACTION_TYPES 注册表(P1: tts)。
- Create `features/chat/messageActions/intentDetect.ts` — keywordIntent + parseIntentResult + detectActionIntent(LLM)。
- Create `features/chat/messageActions/intentDetect.test.ts` — vitest。
- Create `features/chat/messageActions/TtsActionSettings.tsx` — 受控 TTS 设置(VoicePicker+popover,无 composer store)。
- Create `features/chat/messageActions/MessageActionPanel.tsx` — 内联面板。
- Modify `features/chat/ConversationView.tsx` — extraSlot 挂 MessageActionPanel + 回复完成跑意图自动开 + 暴露 append-file。
- Modify `features/chat/MessageBubble.tsx` — 操作行加「⚡产出」按钮(回调)。
- Modify `features/chat/ChatPage.tsx`(若需)— 确保 ConversationView 启用本框架。

## Task 1: 意图识别(TDD)
- [ ] Step1: 写 intentDetect.test.ts:
```ts
import { describe, it, expect } from 'vitest';
import { keywordIntent, parseIntentResult } from './intentDetect';
it('关键词命中 tts', () => {
  expect(keywordIntent('帮我写段开场白并合成语音')).toBe('tts');
  expect(keywordIntent('读一下这段')).toBe('tts');
  expect(keywordIntent('生成一张猫的图')).toBe('t2i');
  expect(keywordIntent('做个短视频')).toBe('t2v');
  expect(keywordIntent('普通问题')).toBe(null);
});
it('解析 LLM JSON 输出', () => {
  expect(parseIntentResult('{"type":"tts","prompt":"你好"}')).toEqual({ type: 'tts', prompt: '你好' });
  expect(parseIntentResult('```json\n{"type":"none"}\n```')).toEqual({ type: 'none', prompt: '' });
  expect(parseIntentResult('garbage')).toEqual({ type: 'none', prompt: '' });
});
```
- [ ] Step2: vitest run 期望 FAIL。
- [ ] Step3: 实现 intentDetect.ts:
```ts
import { aiPlatform } from '@chayuan/api';
export type ActionTypeKey = 'tts' | 't2i' | 'image_edit' | 't2v' | 'i2v';
export type IntentType = ActionTypeKey | 'none';
const KW: Array<[RegExp, ActionTypeKey]> = [
  [/合成语音|生成语音|转语音|朗读|读一下|读出来|配音/, 'tts'],
  [/图生视频|让.{0,6}动起来/, 'i2v'],
  [/生成视频|做.{0,4}视频|短视频/, 't2v'],
  [/图像编辑|改图|p一下|修图/, 'image_edit'],
  [/生成图|画一[张幅]|配图|做[张个]图|海报/, 't2i'],
];
export function keywordIntent(text: string): ActionTypeKey | null {
  const t = (text || '').toLowerCase();
  for (const [re, k] of KW) if (re.test(text || '')) return k;
  void t; return null;
}
export function parseIntentResult(raw: string): { type: IntentType; prompt: string } {
  try {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (!m) return { type: 'none', prompt: '' };
    const o = JSON.parse(m[0]);
    const type = ['tts','t2i','image_edit','t2v','i2v','none'].includes(o.type) ? o.type : 'none';
    return { type, prompt: typeof o.prompt === 'string' ? o.prompt : '' };
  } catch { return { type: 'none', prompt: '' }; }
}
export async function detectActionIntent(args: { userText: string; assistantText: string; chatModelId: string | null }): Promise<{ type: IntentType; prompt: string }> {
  const kw = keywordIntent(args.userText);
  if (!args.chatModelId) return { type: kw ?? 'none', prompt: kw ? args.assistantText : '' };
  try {
    const sys = '判断用户是否想由助手产出物生成媒体。只输出 JSON {"type":"tts|t2i|image_edit|t2v|i2v|none","prompt":"用于生成的提示词或文稿"}。不是生成媒体则 type=none。';
    const r = await aiPlatform.chatCompletion({ model: args.chatModelId, messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `用户:${args.userText}\n助手产出:${args.assistantText.slice(0, 2000)}` },
    ] });
    const text = r.choices?.[0]?.message?.content ?? '';
    const parsed = parseIntentResult(text);
    if (parsed.type !== 'none') return { type: parsed.type, prompt: parsed.prompt || args.assistantText };
    return { type: kw ?? 'none', prompt: kw ? args.assistantText : '' };
  } catch {
    return { type: kw ?? 'none', prompt: kw ? args.assistantText : '' };
  }
}
```
(注:aiPlatform.chatCompletion 的真实签名以 aiPlatform.ts:220-264 为准,实现时对齐。)
- [ ] Step4: vitest run 期望通过。
- [ ] Step5: commit(bump)。

## Task 2: ACTION_TYPES 注册表 + TtsActionSettings
- [ ] Step1: TtsActionSettings.tsx — 受控:props `{ value:{engine,voice,rate,volume,language}, onChange, modelId, onModelChange }`。渲染:本地引擎 chip(Piper/Edge/Sherpa/克隆)+ VoicePicker(hideProviderChips)+ 语速/音量 VerticalSliderPopover + 语言 select。**用 props/本地 state,不读 composer store**。(把 TtsVoiceParamBar 的受控核搬过来。)
- [ ] Step2: actionTypes.tsx — `ACTION_TYPES: Record<ActionTypeKey, ActionType>`,P1 只填 tts:`{ key:'tts', label:'合成语音', icon:Volume2, capability:'tts', Settings: TtsActionSettings, buildModel:(s)=> 'local-tts:'+s.engine 或所选厂商模型 }`。
- [ ] Step3: tsc 通过 → commit。

## Task 3: MessageActionPanel(生成 + 持久化)
- [ ] Step1: MessageActionPanel.tsx props `{ message, initialType, initialPrompt, onClose, onArtifact(file) }`。内容:类型 badge + 可编辑 prompt textarea(默认 initialPrompt||message.content)+ 模型选择(tts 用引擎,内置在 Settings;厂商模型用 ModelMenuList 过滤 capability)+ Settings 组件 + 「确定生成」+ 取消。
- [ ] Step2: 确定 → `streamModality({ model, prompt, params, baseUrl })`(model: tts 本地=local-tts:engine / 厂商=模型id;params: voice_name/voice_rate/voice_volume/language 或厂商 voice/speed)收首个 file part → 绝对 url → onArtifact({mediaType,url,metadata})+ 面板内 AudioRenderer 播放 + 下载。生成中 Loader + 可取消。
- [ ] Step3: tsc 通过 → commit。

## Task 4: 接入 ConversationView + MessageBubble(自动+手动)
- [ ] Step1: ConversationView state `actionPanels: Record<msgId, {type, prompt}>`。`onArtifact` = 把 file 追加到该 message.files(chat.setMessages map),复用既有渲染+持久化。
- [ ] Step2: extraSlot:`extraSlot={(m) => actionPanels[m.id] ? <MessageActionPanel message={m} initialType=.. initialPrompt=.. onClose=.. onArtifact=../> : null}`。若父级已传 extraSlot,做合并(VgChatPage 等)。
- [ ] Step3: 自动触发:监听 assistant 回复完成(streaming false 且有 content)→ 对其对应 user 文本跑 detectActionIntent → type≠none → setActionPanels({[asstId]:{type,prompt}})。(仅普通 chat 链路;每条只触发一次,用 ref 去重。)
- [ ] Step4: MessageBubble 操作行加「⚡产出」按钮(`onAction?:()=>void`),点 → 父级打开类型选择(P1 直接开 tts 面板)。Thread/ConversationView 透传 onAction。
- [ ] Step5: 确保 ChatPage 的 ConversationView 走到这套(默认启用;VgChatPage 不冲突)。
- [ ] Step6: tsc + vitest 全绿 → commit + push。提醒真机重建。

## Self-Review
- 覆盖:内联面板(T3/T4)、LLM 意图+关键词兜底(T1)、持久化(复用 message.files,T4)、自动+手动触发(T4)、复用 VoicePicker/streamModality(T2/T3)。
- 风险:aiPlatform.chatCompletion 签名 T1 对齐;message.files 追加的持久化确认(useArtifactSync);厂商 tts 模型在面板的选择 P1 可后置(先本地引擎跑通)。

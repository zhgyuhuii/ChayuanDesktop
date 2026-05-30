# 实时数字人 RT-P1(对话内核·无口型视频)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 新「实时数字人」页(上=数字人形象、下=对话框):选数字人+模型+知识库+人设 → 输入文字 → LLM 流式回答(带 KB RAG)+ 逐句 TTS 语音顺序播。**无口型视频(RT-P2)、无 GPU。**

**Architecture:** 几乎零新后端——LLM+KB 复用 `createChayuanTransport().chat()`(SSE,`ku_ids` 做 RAG);逐句语音复用 `videoGeneration.previewAudio`。新增:可测的句切器纯函数 + `useSentenceTts` 音频队列 hook + `LiveAvatarPage` + 路由/入口。

**Tech Stack:** TS/React;`@chayuan/transport`(chat SSE)+ `@chayuan/api`(previewAudio);vitest。承接已交付 DH。

---

## 文件结构(全前端)

- `packages/app/src/features/digital-human/liveSentences.ts`(建):句切纯函数(可测)。
- `packages/app/src/features/digital-human/liveSentences.test.ts`(建):vitest。
- `packages/app/src/features/digital-human/useSentenceTts.ts`(建):流式文本→句切→previewAudio→Audio 队列顺序播。
- `packages/app/src/features/digital-human/LiveAvatarPage.tsx`(建):页面(配置条+形象+对话流+composer)。
- `packages/app/src/router/index.tsx`(改):加 `/digital-human/live` 路由。
- `packages/app/src/features/shell/page-registry.tsx`(改):lazy 映射 `/digital-human/live`。
- `packages/app/src/features/digital-human/DigitalHumanPage.tsx`(改):加「实时对话」入口。

> 复用(不另写):`createChayuanTransport`/`ChatRequestV2`(transport)、`videoGeneration.previewAudio`、`digitalHuman.listPresets`/`avatarFileUrl`、`ModelPicker`(`features/chat/ModelPicker.tsx`)、`KnowledgePickerPill`(`features/composer/KnowledgePickerPill.tsx`)。

---

## Task 1: 句切器纯函数(可测核心)

**Files:** `features/digital-human/liveSentences.ts`,`features/digital-human/liveSentences.test.ts`

- [ ] **Step 1: 写失败测试**(vitest)
```ts
import { describe, it, expect } from 'vitest';
import { splitSentences, takeCompleteSentences } from './liveSentences';

describe('liveSentences', () => {
  it('splitSentences 按句末标点切,保留标点;尾部未完句单独一段', () => {
    expect(splitSentences('你好。今天天气不错!走')).toEqual(['你好。', '今天天气不错!', '走']);
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('整句结束。')).toEqual(['整句结束。']);
  });

  it('takeCompleteSentences 只吐"已完成"句(以标点结尾),返回新 consumed 偏移', () => {
    // 累积到"你好。今天" → 只有"你好。"完成
    const r1 = takeCompleteSentences('你好。今天', 0);
    expect(r1.sentences).toEqual(['你好。']);
    expect(r1.consumed).toBe(3);
    // 续到"你好。今天好热!" → 从 consumed=3 起,"今天好热!"完成
    const r2 = takeCompleteSentences('你好。今天好热!', r1.consumed);
    expect(r2.sentences).toEqual(['今天好热!']);
    expect(r2.consumed).toBe('你好。今天好热!'.length);
    // 无新完成句
    const r3 = takeCompleteSentences('你好。今天好热!还', r2.consumed);
    expect(r3.sentences).toEqual([]);
    expect(r3.consumed).toBe(r2.consumed);
  });

  it('换行也算句界;空白句忽略', () => {
    const r = takeCompleteSentences('第一行\n第二句。', 0);
    expect(r.sentences).toEqual(['第一行\n', '第二句。']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd chayuan-client && npx vitest run packages/app/src/features/digital-human/liveSentences.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 liveSentences.ts**
```ts
/**
 * 流式回答的句切器 —— 把 LLM 流式 token 切成"完整句",供逐句 TTS。
 * 句界 = 句末/分隔标点(。！？!?；;:、,，)或换行。纯函数,便于单测。
 */
const SENTENCE_END = /[。！？!?；;：:、,，\n]/;

/** 把文本切成段:每遇句界收一段(含句界字符);尾部无句界的残段也单独成段(未完成)。 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_END.test(ch)) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 从 fromChar 起,取出"已完成"的句(以句界结尾);遇到第一个未完成残段即停。
 * 返回 { sentences, consumed=新的已消费字符数 }。流式里反复调:把 consumed 喂回 fromChar。
 */
export function takeCompleteSentences(
  text: string, fromChar: number,
): { sentences: string[]; consumed: number } {
  const rest = text.slice(fromChar);
  const segs = splitSentences(rest);
  const sentences: string[] = [];
  let consumed = fromChar;
  for (const s of segs) {
    const last = s[s.length - 1] ?? '';
    if (SENTENCE_END.test(last)) { sentences.push(s); consumed += s.length; }
    else break; // 首个未完成残段 → 停
  }
  return { sentences, consumed };
}
```

- [ ] **Step 4: 跑测试确认通过**
Run: `cd chayuan-client && npx vitest run packages/app/src/features/digital-human/liveSentences.test.ts`
Expected: 3 passed

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/liveSentences.ts chayuan-client/packages/app/src/features/digital-human/liveSentences.test.ts
git commit -m "feat(rt-dh): 流式回答句切器(可测纯函数)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: useSentenceTts —— 逐句 TTS + 音频顺序播

**Files:** `features/digital-human/useSentenceTts.ts`

- [ ] **Step 1: 实现**(消费流式文本 → 句切 → previewAudio → Audio 队列顺序播)
```ts
import * as React from 'react';
import { videoGeneration } from '@chayuan/api';
import type { VgVoiceProvider } from '@chayuan/api';
import { takeCompleteSentences } from './liveSentences';

interface VoiceCfg {
  voice_provider?: VgVoiceProvider;
  voice_name?: string;
}

/**
 * 把"流式增长的回答文本"转成"逐句语音顺序播放"。
 * - feed(fullText):每次拿到更长的累积文本调一次;内部切出新完成句 → 入 TTS 队列。
 * - flush():流结束时把残句(未以标点结尾)也合成播。
 * - reset():新一轮回答前清空。
 * 顺序保证:一句 TTS 完成播放(audio.ended)才播下一句;TTS 单句失败跳过不卡队列。
 */
export function useSentenceTts(voice: VoiceCfg, enabled: boolean) {
  const consumedRef = React.useRef(0);
  const queueRef = React.useRef<string[]>([]);
  const playingRef = React.useRef(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);

  const playNext = React.useCallback(async () => {
    if (playingRef.current) return;
    const sentence = queueRef.current.shift();
    if (!sentence) return;
    playingRef.current = true;
    try {
      const { blob } = await videoGeneration.previewAudio({
        video_script: sentence,
        voice_provider: voice.voice_provider,
        voice_name: voice.voice_name || undefined,
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = urlRef.current;
      await new Promise<void>((resolve) => {
        a.onended = () => resolve();
        a.onerror = () => resolve();
        void a.play().catch(() => resolve());
      });
    } catch {
      /* 单句失败:跳过,继续下一句 */
    } finally {
      playingRef.current = false;
      if (queueRef.current.length) void playNext();
    }
  }, [voice.voice_provider, voice.voice_name]);

  const enqueue = React.useCallback((sentences: string[]) => {
    const cleaned = sentences.map((s) => s.trim()).filter((s) => s.length > 0);
    if (!cleaned.length) return;
    queueRef.current.push(...cleaned);
    void playNext();
  }, [playNext]);

  const feed = React.useCallback((fullText: string) => {
    if (!enabled) return;
    const { sentences, consumed } = takeCompleteSentences(fullText, consumedRef.current);
    consumedRef.current = consumed;
    enqueue(sentences);
  }, [enabled, enqueue]);

  const flush = React.useCallback((fullText: string) => {
    if (!enabled) return;
    const rest = fullText.slice(consumedRef.current).trim();
    consumedRef.current = fullText.length;
    if (rest) enqueue([rest]);
  }, [enabled, enqueue]);

  const reset = React.useCallback(() => {
    consumedRef.current = 0;
    queueRef.current = [];
    try { audioRef.current?.pause(); } catch { /* noop */ }
  }, []);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return { feed, flush, reset };
}
```

- [ ] **Step 2: typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"`
Expected: Done(忽略预存在的 `features/license/*` 报错——非本任务;若 grep 到 license 之外的错才算失败)
> 核对:`videoGeneration.previewAudio` 入参是否为 `{video_script, voice_provider, voice_name, voice_rate?, voice_volume?}`(plan 已查证),`VgVoiceProvider` 从 `@chayuan/api` 导出。

- [ ] **Step 3: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/useSentenceTts.ts
git commit -m "feat(rt-dh): useSentenceTts — 逐句 TTS + 音频顺序播队列

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: LiveAvatarPage —— 实时数字人页

**Files:** `features/digital-human/LiveAvatarPage.tsx`

- [ ] **Step 1: 实现**(配置条 + 形象 + 对话流 + composer;流式调 transport.chat + feed useSentenceTts)
先 READ:`features/chat/ModelPicker.tsx`(其 props:如何受控选 model id)、`features/composer/KnowledgePickerPill.tsx`(如何拿 `ku_ids`)、`@chayuan/transport` 的 `createChayuanTransport().chat(req, {traceId})` 与 `ChatRequestV2` 字段(query/mode/model/ku_ids/prompt 等)、`digitalHuman.listPresets`/`avatarFileUrl`。按这些真实 API 接。
骨架(实现者按真实组件 props 接好;保持 var(--cy-*) 风格):
```tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChayuanTransport } from '@chayuan/transport';
import { digitalHuman, type DigitalHumanPreset } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';
import { useSentenceTts } from './useSentenceTts';

const transport = createChayuanTransport();

export const LiveAvatarPage: React.FC = () => {
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });
  const presets = presetsQ.data?.items ?? [];
  const [presetId, setPresetId] = React.useState('');
  const preset: DigitalHumanPreset | undefined = presets.find((p) => p.id === presetId) ?? presets[0];
  const [model, setModel] = React.useState<string | undefined>(undefined);  // 接 ModelPicker
  const [kuIds, setKuIds] = React.useState<string[]>([]);                    // 接 KnowledgePickerPill
  const [persona, setPersona] = React.useState('');
  const [input, setInput] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const tts = useSentenceTts(
    { voice_provider: preset?.voice_provider, voice_name: preset?.voice_name }, true,
  );

  React.useEffect(() => { if (!presetId && presets[0]) setPresetId(presets[0].id); }, [presets, presetId]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true); setAnswer(''); tts.reset();
    let full = '';
    try {
      const req = {
        query: q,
        mode: (kuIds.length ? 'kb' : 'llm') as 'kb' | 'llm',
        model,
        ku_ids: kuIds.length ? kuIds : undefined,
        // 人设:作为 system 提示(以现有 ChatRequestV2 支持的字段承载;实现者核对真实字段名)
        ...(persona.trim() ? { metadata: { system: persona.trim() } } : {}),
      };
      for await (const ev of transport.chat(req as never, { traceId: crypto.randomUUID() })) {
        if (ev.type === 'token' && ev.delta) {
          full += ev.delta;
          setAnswer(full);
          tts.feed(full);
        } else if (ev.type === 'error') {
          reportError(new Error(ev.message), '对话失败');
        }
      }
      tts.flush(full);
      setInput('');
    } catch (e) { reportError(e as Error, '对话失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 配置条:数字人 / 模型 / 知识库 / 人设 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cy-border-subtle)] px-3 py-2 text-sm">
        <select value={presetId} onChange={(e) => setPresetId(e.target.value)}
          className="h-8 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm">
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {/* TODO 接 <ModelPicker value={model} onChange={setModel} /> 与
            <KnowledgePickerPill value={kuIds} onChange={setKuIds} /> —— 用真实 props */}
        <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="人设(可选)"
          className="h-8 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-sm" />
      </div>
      {/* 上:数字人形象 */}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/80 p-2">
        {preset ? (
          preset.avatar_kind === 'image'
            ? <img src={digitalHuman.avatarFileUrl(preset.avatar_ref)} alt={preset.name} className="max-h-full rounded-lg object-contain" />
            : <video src={digitalHuman.avatarFileUrl(preset.avatar_ref)} muted loop autoPlay className="max-h-full rounded-lg object-contain" />
        ) : <span className="text-sm text-white/60">先到「我的数字人」建一个数字人</span>}
      </div>
      {/* 中:流式回答 */}
      {answer && (
        <div className="max-h-40 overflow-y-auto border-t border-[var(--cy-border-subtle)] px-4 py-2 text-sm text-[var(--cy-text-primary)] whitespace-pre-wrap">
          {answer}
        </div>
      )}
      {/* 下:输入 */}
      <div className="flex items-end gap-2 border-t border-[var(--cy-border-subtle)] p-3">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="跟数字人说点什么…(Enter 发送)"
          className="flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-sm" />
        <button onClick={() => void send()} disabled={!input.trim() || busy || !preset}
          className="h-9 rounded-md bg-[var(--cy-brand-500)] px-4 text-sm text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {busy ? '…' : '发送'}
        </button>
      </div>
    </div>
  );
};
```
> 实现者必须把 `ModelPicker` / `KnowledgePickerPill` 用其**真实 props** 接进配置条(替换 TODO 注释),并核对 `ChatRequestV2` 的真实字段(mode 取值集合、人设承载字段——若有 `prompt_name`/`system` 之类用之,否则用 metadata)。`crypto.randomUUID` 浏览器可用;若 lint 报 node 环境,改用项目已有 traceId 生成工具。

- [ ] **Step 2: typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"` → Done(`features/license/*` 预存在报错除外)

- [ ] **Step 3: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/LiveAvatarPage.tsx
git commit -m "feat(rt-dh): 实时数字人页(选数字人/模型/KB/人设 + 流式回答 + 逐句语音)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 路由 + page-registry + 数字人页入口

**Files:** `router/index.tsx`,`features/shell/page-registry.tsx`,`features/digital-human/DigitalHumanPage.tsx`

- [ ] **Step 1: 路由**(`router/index.tsx` 的 `workspaceRoutes` 加,挨着 `/digital-human`)
```tsx
  { path: '/digital-human/live', id: 'digital-human-live' },
```

- [ ] **Step 2: page-registry**(`features/shell/page-registry.tsx`)加 lazy + resolve 分支(照 `/digital-human` 写法,精确匹配 `/digital-human/live`,放在 `/digital-human` 精确匹配之外):
```tsx
const LiveAvatarPage = React.lazy(() =>
  import('../digital-human/LiveAvatarPage').then((m) => ({ default: m.LiveAvatarPage })),
);
```
在 ROUTE_ENTRIES(或等价 resolve 结构)加一条 `pattern: /^\/digital-human\/live$/` → `<LiveAvatarPage />`,`defaultTitle: '实时数字人'`,`defaultIcon: 'user-round'`。**注意**:必须排在 `/^\/digital-human$/` 之前或用精确 `$`,避免被数字人主页 pattern 抢先匹配。

- [ ] **Step 3: 数字人页入口**(`DigitalHumanPage.tsx`)在两 tab 旁加一个「实时对话」按钮 → `navigate({ to: '/digital-human/live' as never })`(用 `useNavigate`,同 GeneratePanel 去模型广场的写法)。

- [ ] **Step 4: typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"` → Done(license 预存在除外)

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/router/index.tsx chayuan-client/packages/app/src/features/shell/page-registry.tsx chayuan-client/packages/app/src/features/digital-human/DigitalHumanPage.tsx
git commit -m "feat(rt-dh): /digital-human/live 路由 + page-registry + 入口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 全链路自检 + 推送

- [ ] **Step 1:** `cd chayuan-client && npx vitest run packages/app/src/features/digital-human/liveSentences.test.ts`(passed)
- [ ] **Step 2:** `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"` → Done(`features/license/*` 预存在报错非本次;确认 `grep -v license` 后我方文件 0 错)
- [ ] **Step 3:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(design 三/四节 RT-P1):实时页+布局(T3)、选数字人/模型/KB/人设(T3)、文字流式 LLM(RAG)(T3 用 transport.chat + ku_ids)、逐句 TTS 语音顺序播(T1 句切 + T2 队列)、入口/路由(T4)。RT-P2(WebRTC+MuseTalk)/RT-P3(ASR)不在本计划。
- **占位扫描**:T3 骨架里 ModelPicker/KnowledgePickerPill 的接入标了"用真实 props"——这是**要求实现者核对真实组件接口**(非 plan 占位);其余无 TBD。
- **类型一致**:`previewAudio({video_script,voice_provider,voice_name})` 三处一致;`takeCompleteSentences(text,fromChar)→{sentences,consumed}` 在 T1 定义、T2 消费一致;`avatar_kind`/`avatar_ref` 与 DH 既有一致。
- **零新后端**:LLM+KB 走现有 `chat/v2/chat`(transport.chat)、TTS 走现有 preview-audio,确认不新增后端。
- **风险**:① `ChatRequestV2` 的"人设"承载字段(system/prompt_name/metadata)需实现者核对真实协议;② `previewAudio` 是 vg 命名但通用 TTS,RT-P1 直接复用——若未来要独立 TTS 端点再抽;③ 本机无后端,流式/TTS 真行为需用户环境验,本计划只验句切单测 + typecheck;④ `features/license/*` typecheck 报错是预存在无关 WIP,核对"license 之外 0 错"即视为通过。

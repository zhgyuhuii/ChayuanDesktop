# 实时数字人 RT-P3(语音输入 ASR)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 给实时数字人对话框加「按住/点击说话」麦克风输入:录音 → 复用现有 ASR(`modality.transcribe`)转文字 → 进编排器(直接走 `send()` 发问)。**纯前端复用,零新后端。**

**Architecture:** 复用 composer 的 `useMicSimpleRecorder`(整段录音,whisper 整段转准确率高)+ `modality.transcribe`(已有 `/modality/asr`+`/modality/transcribe` 后端,composer 在用)。LiveAvatarPage 加麦克风按钮 + 把 `send()` 重构成可接受 override 文本,转写完直接发。

**Tech Stack:** React 19 / `@chayuan/api` 的 `modality.transcribe` / `features/composer/useMicSimpleRecorder` / 浏览器 MediaRecorder+getUserMedia。承接 RT-P1/P2。

---

## ⚠ 本机不可验证边界(执行前必读)

- ✅ 可验:前端 typecheck、`send(override)` 重构后逻辑形状。
- ❌ 只能桌面/浏览器环境验(标 `[VERIFY]`):麦克风权限(Tauri webview getUserMedia 需 `media-access` 权限/HTTPS or localhost)、真录音、ASR sidecar 真转写出字、端到端「说话→转文字→数字人回答+语音」。ASR 后端 whisper 在 CPU 可跑(composer 已验),不需 GPU。

---

## 文件结构

- `packages/app/src/features/digital-human/LiveAvatarPage.tsx`(改):`send()` 接受 override 文本;加麦克风按钮 + `useMicSimpleRecorder` + 转写→发送;录音中状态(elapsed/转写中)。

> 零后端改动。`modality.transcribe` / `useMicSimpleRecorder` 已存在,直接 import。

---

## Task 1: send() 支持 override + 麦克风语音输入

**Files:** `packages/app/src/features/digital-human/LiveAvatarPage.tsx`

> READ 现状(已在 controller context):`send = useCallback(async () => { const q = input.trim(); ... }, [input, busy, liveVideo, model, platformName, kuIds, persona, tts])`;输入区在 line ~450 `<textarea value={input}>` + 发送按钮(line ~476);`reportError` from `'../../store/errorDialog'`;`modality` 可从 `'@chayuan/api'` 导出;recorder hook 在 `packages/app/src/features/composer/useMicSimpleRecorder.ts`,API:`useMicSimpleRecorder({ onRecorded(blob, mimeType), onError(err) }) → { recording, paused, elapsed, stream, start, pause, resume, stop, cancel }`。

- [ ] **Step 1: send() 重构成接受 override 文本**
把 `const send = React.useCallback(async () => { const q = input.trim();` 改成:
```tsx
const send = React.useCallback(async (override?: string) => {
  const q = (override ?? input).trim();
  if (!q || busy) return;
```
其余 body 不动(内部已用 `q`)。`handleKeyDown` 里的 `void send();` 保持不变(无参 = 用 input)。

- [ ] **Step 2: import recorder hook + modality**
顶部 import 区:
```tsx
import { digitalHuman, modality, type DigitalHumanPreset } from '@chayuan/api';
import { useMicSimpleRecorder } from '../composer/useMicSimpleRecorder';
```
(把现有 `import { digitalHuman, type DigitalHumanPreset } from '@chayuan/api';` 合并成上面第一行。)

- [ ] **Step 3: 语音输入 state + hook 接线**
在 `send` 定义之后加(`send` 已支持 override,可被 onRecorded 调用):
```tsx
// ── 语音输入(ASR)──────────────────────────────────────────────────────────
const [transcribing, setTranscribing] = React.useState(false);
const mic = useMicSimpleRecorder({
  onRecorded: async (blob) => {
    setTranscribing(true);
    try {
      const res = await modality.transcribe(blob, { language: 'zh' });
      const text = (res?.text ?? '').trim();
      if (text) {
        setInput(text);          // 显示在输入框,用户可见转写内容
        void send(text);         // 直接进编排器(实时对话=免手发)
      }
    } catch (e) {
      reportError(e as Error, '语音转写失败');
    } finally {
      setTranscribing(false);
    }
  },
  onError: (err) => reportError(err, '麦克风不可用'),
});
const toggleMic = React.useCallback(() => {
  if (mic.recording) mic.stop();      // 停止 → 触发 onRecorded
  else void mic.start();
}, [mic]);
```

- [ ] **Step 4: 麦克风按钮 UI**
在输入区发送按钮旁(line ~476 发送按钮附近)加一个麦克风按钮,样式跟现有按钮一致(复用 `var(--cy-*)` token / 现有 className)。录音时红色 + 显示 `elapsed` 秒;转写中 disabled + 显示「转写中…」:
```tsx
<button
  type="button"
  onClick={toggleMic}
  disabled={busy || transcribing}
  title={mic.recording ? '点击停止并转写' : '点击说话'}
  style={{
    /* 跟发送按钮同款 padding/radius;录音中背景 #ef4444,否则同其它次级按钮 */
  }}
>
  {transcribing ? '转写中…' : mic.recording ? `● ${mic.elapsed}s` : '🎤 说话'}
</button>
```
> 具体 className/style 跟该文件发送按钮取齐(实现者照抄相邻按钮的 style 对象,只改背景色逻辑);图标若文件已用某 icon 库(如 lucide `Mic`/`Square`)则用 icon,否则文字 emoji 兜底。

- [ ] **Step 5: typecheck(单包,全量 OOM)**
Run: `cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"`
Expected: 空。
> `modality.transcribe` 返 `TranscribeResult { text, language, ... }`;`useMicSimpleRecorder` 返类型已在 hook 文件声明。`send` 改 `(override?: string)` 后,`handleKeyDown` 的 `send()` 无参调用仍合法。

- [ ] **Step 6: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/LiveAvatarPage.tsx
git commit -m "feat(rt-dh): 实时数字人语音输入(麦克风→ASR transcribe→进编排)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 自检 + 推送

- [ ] **Step 1:** `cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"`(空)
- [ ] **Step 2:** `cd /work/chayuan-desktop && git log --oneline -3`(确认 RT-P3 commit 在顶)
- [ ] **Step 3:** `git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(design RT-P3:麦克风 → ASR(复用 funasr/whisper)→ 文字进编排器):麦克风按钮 + `useMicSimpleRecorder`(整段录音)+ `modality.transcribe`(复用既有 ASR 后端)+ 转写文本 `send(text)` 进编排,全覆盖。
- **真复用判定**:直接 import 既有 `useMicSimpleRecorder` 组件 + 既有 `modality.transcribe` api,非自实现 mini 版——合格复用。零新后端、零新录音逻辑。
- **占位扫描**:无 TBD。`[VERIFY]` 标的是麦克风权限/真转写需桌面环境,非 plan 占位。
- **不回归**:`send(override?)` 默认 `input`,Enter/发送按钮路径(无参 `send()`)行为不变;`liveVideo` data channel 早返分支不变(语音转写文本同样经 data channel 推,因为走同一个 `send`)。
- **类型一致**:`send: (override?: string) => Promise<void>`;`handleKeyDown` 调 `void send()`(无参合法);`modality.transcribe(blob, {language}) → {text}`。
- **风险/[VERIFY]**:① Tauri webview `getUserMedia` 权限(需 tauri 配置允许 media,桌面实测)② ASR sidecar 未起时 `transcribe` 返空 text(已 try/catch + 不发空)③ 整段录音转写延迟(whisper CPU 冷启偶 ~20s,api 已 45s timeout)—— 全部桌面/浏览器环境验。

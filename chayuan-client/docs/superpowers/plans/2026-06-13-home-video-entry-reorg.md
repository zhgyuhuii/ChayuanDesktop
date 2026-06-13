# 主页视频入口重排 + AI视频生成对话化 + t2v/i2v 区分 + 下载统一 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把左侧「AI视频生成」收敛到主页 8 块入口(2×4),AI视频生成块改对话为主+表单高级模式,区分 t2v/i2v 根治 `input.media` 报错,所有生成媒体统一下载。

**Architecture:** 纯前端(chayuan-client),后端 `/v1/modality/completions` 仅转发不动。复用现成 `startCapabilityChat`(对话)、`AiVideoGenerator`(高级表单)、`getPlatform().fs.saveBinary`(下载)。t2v/i2v 在前端 `inferCapability` 层区分,i2v 进新 `I2V_MODE` 强制传首帧图。

**Tech Stack:** React + TypeScript,pnpm workspace,zustand,TanStack Router,lucide-react,@chayuan/ui。

**验证约定:** 本仓前端无 vitest;每个任务的验证 = 在 `chayuan-client/packages/app` 跑 `node_modules/.bin/tsc -p tsconfig.json --noEmit`(EXIT=0)+ 列出的手测项。所有文件 root 所有,编辑走 sudo(见各任务命令)。分支 main→origin/main。

**重建提示:** 前端改动需重建 desktop + 重启 sidecar 才能在客户端看到。

---

## 文件结构(改动清单)

**Phase 1 — 纯 UI(低风险)**
- Modify: `packages/app/src/features/home/HomePage.tsx`(CAPS 数组 + 网格列数 + import)
- Modify: `packages/app/src/features/shell/Sidebar.tsx`(NAV_ITEMS 删 /ai-video)
- Create: `packages/app/src/lib/downloadMedia.ts`(统一下载工具)
- Modify: `packages/app/src/features/chat/parts/ImageCard.tsx`(下载改 saveBinary)
- Modify: `packages/app/src/features/ai-video/AiVideoGenerator.tsx`(结果视频下载改 saveBinary)
- Modify: `packages/app/src/features/digital-human/DhTaskList.tsx`(下载改 saveBinary)
- Modify: `packages/app/src/features/digital-human/DhProgressCard.tsx`(下载改 saveBinary)
- Modify: `packages/app/src/features/kb/detail/ImageKbDetail.tsx`(下载改 saveBinary)

**Phase 2 — AI视频生成对话入口 + 高级模式**
- Modify: `packages/app/src/features/home/HomePage.tsx`(ai-video 块 onCapClick 走 startCapabilityChat)
- Modify: `packages/app/src/features/composer/VideoGenParamBar.tsx`(加「高级模式」按钮 + Dialog 嵌 AiVideoGenerator)

**Phase 3 — t2v/i2v 区分(根治 input.media)**
- Modify: `packages/transport/src/modality-stream.ts`(ModalityCapability 加 'i2v')
- Modify: `packages/app/src/features/composer/modelCapabilityChip.tsx`(CAP_META 加 i2v + inferCapability 判 i2v + INTERACTIVE_CAPABILITIES)
- Modify: `packages/app/src/features/composer/composerMode.ts`(加 I2V_MODE + MODE_TABLE)
- Modify: `packages/app/src/features/ai-video/AiVideoGenerator.tsx`(选 i2v 时参考图必填)

---

## Phase 1 — 纯 UI

### Task 1: 主页 8 块布局 + 命名(图文成片)

**Files:**
- Modify: `packages/app/src/features/home/HomePage.tsx`

注:本任务先只做「重排 + 改名 + 加占位 ai-video 块(暂用普通 navigate)」,ai-video 块的对话行为在 Phase 2 Task 6 接上。

- [ ] **Step 1: import 加 Wand2 图标**

把(`HomePage.tsx:23-26`):
```tsx
import {
  Library, Pen, ScanText, Mic, Clapperboard, UserRound,
  AlertCircle, Film,
} from 'lucide-react';
```
改为:
```tsx
import {
  Library, Pen, ScanText, Mic, Clapperboard, UserRound,
  AlertCircle, Film, Wand2,
} from 'lucide-react';
```

- [ ] **Step 2: CAPS 数组加 ai-video 块 + 改名 + 排序**

在 `notes` 块对象之后、`video-generation` 块对象之前,插入新块:
```tsx
  {
    id: 'ai-video',
    icon: Wand2,
    title: 'AI视频生成',
    subtitle: '文生 / 图生视频 · AI 模型直接生成画面',
    to: '/chat',
    gradient: 'from-violet-50 to-fuchsia-100 dark:from-violet-900/30 dark:to-fuchsia-800/40',
    iconBg: 'bg-gradient-to-br from-violet-400 to-fuchsia-500',
  },
```
并把原 `video-generation` 块的 `title: '视频生成',` 改为 `title: '图文成片',`(`to` 保持 `/video-generation` 不变)。

最终 CAPS 顺序应为:`kb, image-to-text, audio-to-text, notes, ai-video, video-generation, digital-human, video-editing`(共 8 项)。

- [ ] **Step 3: 网格列数改 4 列**

把(`HomePage.tsx:294`):
```tsx
      <div className="relative z-10 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
```
改为:
```tsx
      <div className="relative z-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
```
顺手把 291-293 行注释里的「窄屏 3 列 / sm 4 列 / lg 7 列单行」改成「窄屏 2 列 / sm 起 4 列 × 2 行」;把文件头 6 行「5 张炫酷功能入口卡」过时描述忽略即可(不强制改)。

- [ ] **Step 4: typecheck**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/home/HomePage.tsx
sudo git commit -m "feat(home): 主页入口重排为 8 块 2x4 + 新增 AI视频生成块 + 视频生成改名图文成片"
```

手测:主页应显示 8 个块,2 行 4 列;第2行为 AI视频生成 / 图文成片 / 数字人 / 视频编辑。(此时点 AI视频生成会 navigate 到 /chat,Phase 2 改为开 t2v 对话。)

---

### Task 2: 隐藏左侧菜单「AI视频生成」

**Files:**
- Modify: `packages/app/src/features/shell/Sidebar.tsx`

- [ ] **Step 1: 删 NAV_ITEMS 的 /ai-video 项**

把(`Sidebar.tsx:83`):
```tsx
  { to: '/ai-video', labelKey: 'nav.aiVideo', icon: Film },
```
整行删除。

- [ ] **Step 2: 处理可能未使用的 Film import**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && grep -n "Film" src/features/shell/Sidebar.tsx`
若除 import 行外无其它使用,则从 Sidebar.tsx 顶部 import 里移除 `Film`(避免 noUnusedLocals 报错)。若仍有使用则保留。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 4: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/shell/Sidebar.tsx
sudo git commit -m "feat(shell): 隐藏左侧菜单 AI视频生成(收敛到主页入口块)"
```

手测:左侧菜单不再出现「AI视频生成」项;`/ai-video` 路由仍可用(page-registry 未动)。

---

### Task 3: 统一下载工具 downloadMedia.ts

**Files:**
- Create: `packages/app/src/lib/downloadMedia.ts`

- [ ] **Step 1: 新建工具文件**

内容:
```ts
import { getPlatform } from '@chayuan/platform-shared';

/**
 * 下载远程 URL 为本地文件 — 统一走平台 saveBinary(Tauri 弹原生「保存位置」
 * 对话框 + 写文件;web 用 showSaveFilePicker / anchor)。
 *
 * 为什么不用 <a download>:Tauri webview 里静态 <a download> 不触发下载,
 * 必须 fetch 成 blob 再交给 saveBinary。范例见 video-generation/VideoLibraryPage.tsx。
 *
 * @param name 建议的保存文件名(含扩展名)
 * @param url  资源 URL(http/https 或后端任务文件 URL)
 */
export async function downloadUrlAsFile(name: string, url: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`);
  const blob = await resp.blob();
  await getPlatform().fs.saveBinary(name, blob);
}
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(确认 `@chayuan/platform-shared` 的 `getPlatform().fs.saveBinary(name, blob)` 类型匹配)

- [ ] **Step 3: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/lib/downloadMedia.ts
sudo git commit -m "feat(lib): 加统一媒体下载工具 downloadUrlAsFile(走 saveBinary)"
```

---

### Task 4: 对话生成图下载改用 saveBinary(ImageCard)

**Files:**
- Modify: `packages/app/src/features/chat/parts/ImageCard.tsx`

- [ ] **Step 1: import 下载工具**

在 ImageCard.tsx 现有 import 区加一行:
```ts
import { downloadUrlAsFile } from '../../../lib/downloadMedia';
```
(确认相对层级:文件在 `features/chat/parts/`,lib 在 `src/lib/` → `../../../lib/downloadMedia`。)

- [ ] **Step 2: onDownload 改走 saveBinary**

把现有 onDownload(ImageCard.tsx 约 49-69 行):
```ts
  const onDownload = async () => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const dl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dl);
    } catch {
      // 退化:浏览器自己处理 (会打开图)
      window.open(url, '_blank');
    }
  };
```
替换为:
```ts
  const onDownload = async () => {
    try {
      await downloadUrlAsFile(filename, url);
    } catch {
      // 退化:浏览器自己处理 (会打开图)
      window.open(url, '_blank');
    }
  };
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 4: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/chat/parts/ImageCard.tsx
sudo git commit -m "fix(chat): 对话生成图下载改走 saveBinary(Tauri 原生保存,修 <a download> 不触发)"
```

手测:对话里生成的图 hover → 下载,弹原生保存框。

---

### Task 5: 视频结果下载统一(AiVideoGenerator / DhTaskList / DhProgressCard / ImageKbDetail)

**Files:**
- Modify: `packages/app/src/features/ai-video/AiVideoGenerator.tsx`
- Modify: `packages/app/src/features/digital-human/DhTaskList.tsx`
- Modify: `packages/app/src/features/digital-human/DhProgressCard.tsx`
- Modify: `packages/app/src/features/kb/detail/ImageKbDetail.tsx`

- [ ] **Step 1: AiVideoGenerator 结果视频下载改按钮**

import 加:`import { downloadUrlAsFile } from '../../lib/downloadMedia';`(文件在 `features/ai-video/` → `../../lib/`)。
把结果区(约 477-483 行):
```tsx
            <a
              href={videoUrl}
              download
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--cy-border-default)] bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
            >
              <Download className="h-3.5 w-3.5" />
              下载视频
            </a>
```
替换为:
```tsx
            <button
              type="button"
              onClick={() => { void downloadUrlAsFile('AI视频.mp4', videoUrl); }}
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--cy-border-default)] bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
            >
              <Download className="h-3.5 w-3.5" />
              下载视频
            </button>
```

- [ ] **Step 2: DhTaskList 下载改按钮**

import 加:`import { downloadUrlAsFile } from '../../lib/downloadMedia';`(`features/digital-human/` → `../../lib/`)。
把(DhTaskList.tsx 约 131 行):
```tsx
                        <a href={digitalHuman.taskFileUrl(t.task_id)} download className="text-[var(--cy-brand-500)] hover:underline">下载</a>
```
替换为:
```tsx
                        <button type="button" onClick={() => { void downloadUrlAsFile(`${(t.name || '数字人').replace(/[\\/:*?"<>|·]/g, '_').slice(0, 40)}.mp4`, digitalHuman.taskFileUrl(t.task_id)); }} className="text-[var(--cy-brand-500)] hover:underline">下载</button>
```

- [ ] **Step 3: DhProgressCard 下载改按钮**

import 加:`import { downloadUrlAsFile } from '../../lib/downloadMedia';`。
把(DhProgressCard.tsx 约 75 行):
```tsx
          <a href={digitalHuman.taskFileUrl(taskId)} download className={linkCls}>下载</a>
```
替换为:
```tsx
          <button type="button" onClick={() => { void downloadUrlAsFile('数字人.mp4', digitalHuman.taskFileUrl(taskId)); }} className={linkCls}>下载</button>
```

- [ ] **Step 4: ImageKbDetail 下载改按钮**

import 加:`import { downloadUrlAsFile } from '../../../lib/downloadMedia';`(`features/kb/detail/` → `../../../lib/`)。
把(ImageKbDetail.tsx 约 826-834 行):
```tsx
        <a
          href={src}
          download={img.id}
          className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs text-white backdrop-blur hover:bg-white/20"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" /> 下载原图
        </a>
```
替换为:
```tsx
        <button
          type="button"
          className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs text-white backdrop-blur hover:bg-white/20"
          onClick={(e) => { e.stopPropagation(); void downloadUrlAsFile(img.id || 'image', src); }}
        >
          <Download className="h-3.5 w-3.5" /> 下载原图
        </button>
```

- [ ] **Step 5: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(若某文件 `Download` 图标未 import 报错,按报错补 lucide import;若 `src` 可能为空已被外层 `{src && (...)}` 守卫)

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/ai-video/AiVideoGenerator.tsx packages/app/src/features/digital-human/DhTaskList.tsx packages/app/src/features/digital-human/DhProgressCard.tsx packages/app/src/features/kb/detail/ImageKbDetail.tsx
sudo git commit -m "fix(download): 视频/原图下载统一走 saveBinary(修 Tauri <a download> 不触发)"
```

手测:AI视频结果、数字人任务、图像 KB 详情的下载都弹原生保存框。

**Phase 1 完成 → 给用户审 + 重建验证。**

---

## Phase 2 — AI视频生成对话入口 + 高级模式

### Task 6: 主页 AI视频生成块走对话式 t2v

**Files:**
- Modify: `packages/app/src/features/home/HomePage.tsx`

- [ ] **Step 1: import 对话能力依赖**

在 HomePage.tsx import 区加:
```ts
import {
  pickBestModel,
  useAvailableModelsByCapability,
} from './capabilityCards/useAvailableModelsByCapability';
import { startCapabilityChat } from './capabilityCards/startCapabilityChat';
```

- [ ] **Step 2: 组件内取 byCap**

在 `HomePage` 组件函数体内(与其它 hook 并列,如 `const catalog...` 附近)加:
```ts
  const { byCap } = useAvailableModelsByCapability();
```

- [ ] **Step 3: onCapClick 对 ai-video 块走 startCapabilityChat**

把现有 `onCapClick`(HomePage.tsx 171-181)改为:
```ts
  const onCapClick = (cap: CapItem) => {
    // AI视频生成块:开一个对话式 t2v(对话生成视频),不走普通路由 navigate。
    // 复用能力卡的「按模型类型开始对话」逻辑;无可用 t2v 模型则引导去模型厂商。
    if (cap.id === 'ai-video') {
      const best = pickBestModel(byCap.get('t2v'));
      if (!best) {
        open('/marketplace', { title: '模型厂商', icon: 'server' });
        void navigate({ to: '/marketplace' as never });
        return;
      }
      startCapabilityChat(
        { cap: 't2v', model: best },
        { navigate: (to) => void navigate({ to: to as never }) },
      );
      return;
    }
    // 「AI 笔记」每次进来都是空白:已有 `/notes/new` tab 先关掉,让 NoteEditorPage
    // 重新 mount → useMemo 生成新 draftKey → 不会被上次未保存草稿污染。
    if (cap.id === 'notes') {
      const store = useTabsStore.getState();
      const existing = store.tabs.find((t) => t.path === cap.to);
      if (existing) store.close(existing.id);
    }
    open(cap.to, { title: cap.title, icon: cap.id });
    void navigate({ to: cap.to as never });
  };
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(确认 `pickBestModel` / `useAvailableModelsByCapability` / `startCapabilityChat` 签名与 CapabilityCardGrid 用法一致)

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/home/HomePage.tsx
sudo git commit -m "feat(home): AI视频生成块改为开对话式 t2v(复用 startCapabilityChat)"
```

手测:点主页「AI视频生成」→ 新开 t2v 对话(文生视频模式);无 t2v 模型时跳模型厂商。

---

### Task 7: t2v 参数条加「高级模式」按钮 → AiVideoGenerator 表单 Dialog

**Files:**
- Modify: `packages/app/src/features/composer/VideoGenParamBar.tsx`

- [ ] **Step 1: import Dialog / 按钮 / 表单 / 图标**

在 VideoGenParamBar.tsx import 区加:
```ts
import { SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@chayuan/ui';
import { AiVideoGenerator } from '../ai-video/AiVideoGenerator';
```
(确认 `@chayuan/ui` 导出 `Dialog/DialogContent/DialogTitle` — GeneratePanel.tsx 已用同样三件套。)

- [ ] **Step 2: 组件内加 Dialog 开关 state**

在 `VideoGenParamBar` 组件体顶部(`const params = ...` 附近)加:
```ts
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
```

- [ ] **Step 3: 在参数条末尾加「高级模式」按钮 + Dialog**

在 `VideoGenParamBar` 的最外层 `<div role="toolbar" ...>` 闭合标签 `</div>` 之前(参数条所有现有内容之后)加入:
```tsx
      <button
        type="button"
        onClick={() => setAdvancedOpen(true)}
        title="高级模式:更多分辨率 / 比例 / 参考图等参数"
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
      >
        <SlidersHorizontal className="h-3 w-3" /> 高级模式
      </button>
      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="flex h-[80vh] w-[min(880px,92vw)] max-w-none flex-col">
          <DialogTitle>AI视频生成 · 高级模式</DialogTitle>
          <div className="flex min-h-0 flex-1">
            <AiVideoGenerator compact />
          </div>
        </DialogContent>
      </Dialog>
```
(`ml-auto` 让按钮靠右;若现有结构已用 flex-wrap,按钮会自然排到行尾。)

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(确认 `AiVideoGenerator` 的 props 接受 `compact`;确认 DialogContent 的 className 用法与 @chayuan/ui 一致)

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/composer/VideoGenParamBar.tsx
sudo git commit -m "feat(composer): t2v 参数条加「高级模式」→ 弹 AiVideoGenerator 表单(复用)"
```

手测:进 t2v 对话 → 参数条出现「高级模式」→ 点开弹出表单(含分辨率/比例/参考图);表单生成可用、可下载。

**Phase 2 完成 → 给用户审 + 重建验证。**

---

## Phase 3 — t2v/i2v 区分(根治 input.media)

### Task 8: ModalityCapability 加 'i2v'

**Files:**
- Modify: `packages/transport/src/modality-stream.ts`

- [ ] **Step 1: 类型加 i2v**

把(modality-stream.ts 约 33-43):
```ts
export type ModalityCapability =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 't2i'
  | 't2v'
  | 'image_edit'
  | 'tts'
  | 'asr'
  | 'vl'
  | 'ocr';
```
改为(在 t2v 后加 i2v):
```ts
export type ModalityCapability =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 't2i'
  | 't2v'
  | 'i2v'
  | 'image_edit'
  | 'tts'
  | 'asr'
  | 'vl'
  | 'ocr';
```
注:`classifyModalityCapability`(按模型名前缀)内部仍把 i2v 名判为 't2v' 不动 —— i2v 的细分在 app 层的 `inferCapability`(Task 9)做,避免改前后端共享的名字真源。

- [ ] **Step 2: typecheck(全 workspace,因 transport 被多包消费)**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: 可能出现「MODE_TABLE / CAP_META 缺 i2v 键」类报错 —— 这是预期的,Task 9/10 补齐后归零。本步只确认 transport 自身类型无误;若 app typecheck 报的是上述「缺 i2v 成员」即正常,继续 Task 9。

- [ ] **Step 3: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/transport/src/modality-stream.ts
sudo git commit -m "feat(transport): ModalityCapability 增加 i2v(图生视频)能力"
```

---

### Task 9: app 层区分 i2v(CAP_META + inferCapability + INTERACTIVE)

**Files:**
- Modify: `packages/app/src/features/composer/modelCapabilityChip.tsx`

- [ ] **Step 1: CAP_META 加 i2v 元数据**

在 CAP_META 数组里 `t2v` 那一项对象之后插入:
```ts
  {
    cap: 'i2v',
    label: '图生视频',
    longLabel: '图生视频模型',
    classes:
      'bg-orange-50 text-orange-700 border border-orange-200 ' +
      'dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/60',
    classesActive: 'bg-orange-600 text-white border-orange-600',
  },
```

- [ ] **Step 2: inferCapability 识别 i2v**

把(modelCapabilityChip.tsx 约 171-187 的 inferCapability)开头两行:
```ts
export function inferCapability(m: RawModelItem): ModalityCapability {
  const byName = classifyModalityCapability(m.id);
  if (byName !== 'chat') return byName; // 命中专有 capability 直接用
```
改为:
```ts
export function inferCapability(m: RawModelItem): ModalityCapability {
  const byName = classifyModalityCapability(m.id);
  // 名字含 i2v / image2video → 细分为图生视频(transport classify 把它们统判成 t2v)
  if (byName === 't2v' && /i2v|image2video|img2video/i.test(m.id)) return 'i2v';
  if (byName !== 'chat') return byName; // 命中专有 capability 直接用
```
并在同函数下方按 model_type 判断处,`t === 'text2video'...return 't2v'` 那一行**之前**加:
```ts
  if (t === 'image2video' || t === 'i2v' || t === 'img2video') return 'i2v';
```

- [ ] **Step 3: INTERACTIVE_CAPABILITIES 含 i2v**

把(约 143-145):
```ts
export const INTERACTIVE_CAPABILITIES: ReadonlySet<ModalityCapability> = new Set([
  'chat', 'vl', 't2i', 'image_edit', 't2v', 'tts', 'asr', 'ocr',
]);
```
改为:
```ts
export const INTERACTIVE_CAPABILITIES: ReadonlySet<ModalityCapability> = new Set([
  'chat', 'vl', 't2i', 'image_edit', 't2v', 'i2v', 'tts', 'asr', 'ocr',
]);
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: 仍可能报 `getComposerMode`/MODE_TABLE 缺 i2v —— Task 10 补;CAP_INDEX(由 CAP_META 建)现已含 i2v。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/composer/modelCapabilityChip.tsx
sudo git commit -m "feat(composer): inferCapability 区分 i2v(图生视频)+ 能力 chip 元数据"
```

---

### Task 10: I2V_MODE(选 i2v 强制传首帧图)

**Files:**
- Modify: `packages/app/src/features/composer/composerMode.ts`

- [ ] **Step 1: 新增 I2V_MODE 配置**

在 composerMode.ts 的 `T2V_MODE` 常量定义之后插入:
```ts
const I2V_MODE: ComposerModeConfig = {
  capability: 'i2v',
  label: '图生视频',
  icon: Clapperboard,
  colorClass: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/60',
  placeholder: '上传首帧图 + 描述运动,例如:让画面里的人物挥手…',
  submitLabel: '生成视频 ▶',
  attachmentRule: 'required-image',
  paramKind: 'video_size_dur',
  hint: '图生视频必须先上传一张首帧参考图;约需 30-90 秒,可后台继续',
  hidePills: ['knowledge', 'search'],
  backendPath: 'modality',
};
```

- [ ] **Step 2: MODE_TABLE 注册 i2v**

把(约 224-235 的 MODE_TABLE)里 `t2v: T2V_MODE,` 那行之后加:
```ts
  i2v: I2V_MODE,
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`(此时 ModalityCapability 的所有成员在 MODE_TABLE / CAP_META 都已覆盖)

- [ ] **Step 4: 验证对话取模式确实经 inferCapability**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && grep -rn "inferCapability\|classifyModalityCapability\|getComposerMode" src/features/composer/ComposerModelPill.tsx src/features/composer/ChatComposer.tsx src/features/chat/ConversationView.tsx`
确认「选中模型 → 推断 capability → getComposerMode」这条链用的是 `inferCapability`(已识别 i2v)。**若发现某处直接用 `classifyModalityCapability(modelId)` 推断对话模式(会把 i2v 误判 t2v)**,把那一处改成 `inferCapability(model)`(需要 RawModelItem;就近取已加载的模型对象)。把改动连同验证结论记录到 commit message。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/composer/composerMode.ts
sudo git commit -m "feat(composer): 新增 I2V_MODE(图生视频强制传首帧图),修选 i2v 模型报 input.media"
```

手测:对话里选 i2v 模型(如 wanx2.1-i2v)→ 模式变「图生视频」,附件变必填;不传图发送被拦,传图后发送成功、不再报 `Field required: input.media`;选 t2v 模型仍不传图、正常生成。

---

### Task 11: 高级表单按 t2v/i2v 区分参考图

**Files:**
- Modify: `packages/app/src/features/ai-video/AiVideoGenerator.tsx`

- [ ] **Step 1: 判定当前选中模型是否 i2v**

在 `AiVideoGenerator` 组件体内、`modelOptions` 定义附近加:
```ts
  // 选中模型是否 i2v(图生视频)→ 参考图必填;t2v 则隐藏参考图
  const isI2v = /i2v|image2video|img2video/i.test(selectedModel);
```

- [ ] **Step 2: 参考图区按 isI2v 切换 必填/隐藏**

把首帧参考图区块(约 320-360 的 `{/* 首帧图（可选） */}` 整段)外层包条件:t2v 时不渲染该区块;i2v 时 label 改「(必填)」。即把该 `<div className="flex flex-col gap-1"> ... </div>`(整段参考图)替换为:
```tsx
        {isI2v && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--cy-text-secondary)]">
              首帧参考图
              <span className="ml-1 font-normal text-[var(--cy-danger-500)]">（必填）</span>
            </label>
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={handleImageChange}
              className="text-xs text-[var(--cy-text-secondary)] file:mr-2 file:cursor-pointer file:rounded file:border file:border-[var(--cy-border-default)] file:bg-[var(--cy-surface-1)] file:px-2 file:py-0.5 file:text-xs file:text-[var(--cy-text-primary)] file:hover:bg-[var(--cy-surface-2)]"
            />
            {imagePreview && (
              <div className="relative mt-1 overflow-hidden rounded-lg border border-[var(--cy-border-subtle)]">
                <img src={imagePreview} alt="首帧预览" className="max-h-32 w-full object-cover" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/70"
                >
                  移除
                </button>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 3: i2v 缺图时拦截生成**

在 `handleGenerate` 开头的 `if (!selectedModel || !prompt.trim()) return;` 之后加:
```ts
    if (isI2v && !imageFile) {
      setErrorMsg('图生视频必须上传首帧参考图');
      setGenState('error');
      return;
    }
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/app/src/features/ai-video/AiVideoGenerator.tsx
sudo git commit -m "feat(ai-video): 高级表单选 i2v 模型时参考图必填、t2v 时隐藏"
```

手测:高级模式表单选 i2v 模型 → 参考图标必填、缺图点生成被拦;选 t2v → 参考图区隐藏。

**Phase 3 完成 → 给用户审 + 重建验证。**

---

## 自检与覆盖核对

- 主页 8 块 2×4 + 命名「图文成片」「AI视频生成」→ Task 1 ✓
- 隐藏左菜单 AI视频生成 → Task 2 ✓
- AI视频生成块对话为主 → Task 6 ✓;高级模式表单 → Task 7 ✓
- t2v/i2v 区分(前端根治 input.media)→ Task 8/9/10/11 ✓
- 下载按钮统一(生成图 + 视频)→ Task 3/4/5 ✓
- 文生视频能力卡保留(用户选择)→ 不动 capabilityCardCatalog ✓
- 后端不动 ✓

## 风险

- Task 10 Step 4 是关键验证点:若对话模式推断未走 `inferCapability`,i2v 仍会被判 t2v;必须按该步排查并改到。
- i2v 判定靠模型名启发式(`i2v/image2video/img2video`);命名不规范的 i2v 模型可能漏判(范围外:后续给 catalog 加 image2video_models 字段)。
- 各下载点的 `Download` lucide import 若缺需按 typecheck 报错补。

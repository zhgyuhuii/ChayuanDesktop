# P3：AI 视频作为时间轴 clip 源 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 文生/图生视频生成的片段能落进 VG 素材库并用进时间轴——抽共享生成组件，接两个入口（素材面板「AI 生成」Tab + 独立 /ai-video 页「导入素材库」）。

**Architecture:** 把 `/ai-video` 页的生成表单抽成可复用 `AiVideoGenerator`；新增 `ingestAiVideo(url)` 调现有 `vgIngestMedia` 落库成 material；两入口共用。时间轴数据结构/拖拽/EDL 渲染不动（已天然支持 material_id）。

**Tech Stack:** React + TS、TanStack Query、`@chayuan/api`(`aiVideoGenerate`/`aiVideoListModels`/`vgIngestMedia`)、`@chayuan/ui`。

**P3 范围收敛（YAGNI）：** 不做「AI Tab 一键加到当前时间轴」——MaterialsStep 复用于向导/编辑器两处、无统一时间轴上下文,落库进「我的素材」后拖进轨道（现有拖拽）即可。直接 append 留后续。

**验证约定：** 前端用仓库内置 tsc（`node_modules/.bin/tsc -p packages/<pkg>/tsconfig.json --noEmit`）；app 包无组件测试框架,以 typecheck + 人工实测为门。后端若改 `materials/ingest` 用 `ast.parse`（py312 pytest 待用户机器）。**改完直接 commit+push（用户常驻规则）**。仓库 root 所有,编辑前 chown 给 admin、完事 chown 回 root。

仓库根 `/work/chayuan-desktop`,前端根 `chayuan-client`。

---

## File Structure

- `packages/app/src/features/ai-video/AiVideoGenerator.tsx` — 新建：可复用生成组件（表单+进度+结果预览）。
- `packages/app/src/features/ai-video/ingestAiVideo.ts` — 新建：URL→material 落库 helper。
- `packages/app/src/features/ai-video/AiVideoPage.tsx` — 修改：改用 `AiVideoGenerator` + 结果区加「导入素材库」。
- `packages/app/src/features/video-generation/steps/MaterialsStep.tsx` — 修改：加「AI 生成」Tab。
- （条件）`chayuan-server/.../video_generation/steps/materials.py` — 若 ingest 不收 artifact URL 再小改。

---

## Task A1: 抽 `AiVideoGenerator` 共享组件 + 重构 AiVideoPage

**Files:**
- Create: `packages/app/src/features/ai-video/AiVideoGenerator.tsx`
- Modify: `packages/app/src/features/ai-video/AiVideoPage.tsx`

**实现前先读** `AiVideoPage.tsx` 全文（state L113-135、`onGenerate`/`gate.guard` L184+、结果区 `<video>`+下载 L429-465）。把「表单 + 生成逻辑 + 进度 + 结果预览」搬进 `AiVideoGenerator`,`AiVideoPage` 只留页面壳 + 结果操作区。

- [ ] **Step 1: 新建 `AiVideoGenerator.tsx`**

把 AiVideoPage 的这些搬进来（原样迁移,不改行为）：state（models/modelsLoading/selectedModel/prompt/imageFile/imagePreview/duration/resolution/ratio/genState/progress/videoUrl/errorMsg）+ `useUsageGate('video')` + 加载模型 effect + `onGenerate`（gate.guard → 读图转 b64 → `aiVideoGenerate` onProgress/onVideo）+ 表单 JSX + 进度条 + 结果 `<video>` 预览。组件签名：
```tsx
export interface AiVideoGeneratorProps {
  /** 生成成功拿到视频 URL 时回调(artifact url),给上层做"导入素材库/加时间轴"。 */
  onGenerated?: (videoUrl: string) => void;
  /** 紧凑布局(嵌素材面板 Tab 用):去掉大留白,表单竖排。 */
  compact?: boolean;
}
export const AiVideoGenerator: React.FC<AiVideoGeneratorProps> = ({ onGenerated, compact }) => { /* ... */ };
```
在 `onVideo`(拿到 url)处,除了 `setVideoUrl(url)` 再调 `onGenerated?.(url)`。`UsageGateDialogs` 留在组件内（保证门控弹窗渲染）。`compact` 控制外层容器 className（compact 时窄/竖排）。

- [ ] **Step 2: 重构 `AiVideoPage.tsx`**

`AiVideoPage` 改为：页面标题/容器 + `<AiVideoGenerator onGenerated={setLastVideoUrl} />` + 结果操作区（下载 + 「导入素材库」,A3 加按钮）。删掉已搬走的 state/逻辑。保留路由不变。
```tsx
export const AiVideoPage: React.FC = () => {
  const [lastVideoUrl, setLastVideoUrl] = React.useState<string | null>(null);
  return (
    <div className="...page container...">
      <h1>...AI 视频生成...</h1>
      <AiVideoGenerator onGenerated={setLastVideoUrl} />
      {/* A3 在这里加「导入素材库」按钮,用 lastVideoUrl */}
    </div>
  );
};
```
（若 `AiVideoGenerator` 内部已展示结果 video+下载,`AiVideoPage` 不必重复;「导入素材库」按钮 A3 决定放组件内还是页面内——见 A3。）

- [ ] **Step 3: typecheck**
```bash
cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit
```
Expected: 0 error。

---

## Task A2: `ingestAiVideo` 落库 helper

**Files:**
- Create: `packages/app/src/features/ai-video/ingestAiVideo.ts`

**实现前先读** `packages/api/src/videoGeneration.ts` 的 `vgIngestMedia`(约 L666,确认签名 `{url,kind,source}` 与返回 `VgMaterial`)、`getClientConfig`(取 baseURL,把相对 artifact URL 拼绝对)。

- [ ] **Step 1: 写 helper**
```ts
import { vgIngestMedia, getClientConfig, type VgMaterial } from '@chayuan/api';

/** 把 AI 生成的视频(artifact URL,可能是相对 /v1/artifacts/...)落库成 VG 素材。 */
export async function ingestAiVideo(videoUrl: string): Promise<VgMaterial> {
  let url = videoUrl;
  if (url.startsWith('/')) {
    const base = (getClientConfig().baseURL || '').replace(/\/+$/, '');
    url = base + url;
  }
  return vgIngestMedia({ url, kind: 'video', source: 'ai-video' });
}
```
（`getClientConfig`/`VgMaterial` 的真实导出名以 `@chayuan/api` 实际为准,实现时核对;若 `getClientConfig` 不从 barrel 导出,从其所在模块 import。）

- [ ] **Step 2: typecheck**
```bash
cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit
```
Expected: 0 error。

---

## Task A3: `/ai-video` 页「导入素材库」按钮

**Files:**
- Modify: `packages/app/src/features/ai-video/AiVideoPage.tsx`（或 `AiVideoGenerator.tsx` 的结果区,取决于 A1 把结果区放哪）

- [ ] **Step 1: 加按钮 + 状态**

在结果区(有 `videoUrl` 时)「下载」旁加「导入素材库」：
```tsx
import { ingestAiVideo } from './ingestAiVideo';
// ...
const [importing, setImporting] = React.useState(false);
const [imported, setImported] = React.useState(false);
const onImport = async () => {
  if (!videoUrl) return;
  setImporting(true);
  try {
    await ingestAiVideo(videoUrl);
    setImported(true);
  } catch (e) {
    // 复用页面错误提示;至少 console + 一行红字
  } finally {
    setImporting(false);
  }
};
// JSX(结果区,下载按钮旁):
<button type="button" onClick={() => void onImport()} disabled={importing || imported}
  className="...次按钮样式(var(--cy-*))...">
  {imported ? '已导入素材库' : importing ? '导入中…' : '导入素材库'}
</button>
{imported && <p className="text-[11px] text-[var(--cy-text-tertiary)]">可在「视频编辑 → 素材库 → 我的素材」里使用</p>}
```

- [ ] **Step 2: typecheck**
```bash
cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit
```
Expected: 0 error。

---

## Task A4: MaterialsStep 加「AI 生成」Tab

**Files:**
- Modify: `packages/app/src/features/video-generation/steps/MaterialsStep.tsx`

**实现前先读** `MaterialsStep.tsx`：Tab 类型 L43、`TABS` 数组 L45-50、tab 渲染 switch L125-132、`qc`(useQueryClient)、`MineTab` 的素材 query key `['vg.materials', ...]` L158。

- [ ] **Step 1: 加 Tab 类型 + 条目**

L43 `type Tab` 加 `| 'ai'`：
```tsx
type Tab = 'mine' | 'online' | 'link' | 'upload' | 'ai';
```
`TABS` 数组（L45-50）加一条（图标用已 import 的 lucide,如 `Sparkles`/`Clapperboard`,没有就补 import）：
```tsx
  { id: 'ai', label: 'AI 生成', icon: Sparkles },
```

- [ ] **Step 2: 加 AI Tab 渲染 + 子组件**

tab 渲染区（L125-132 附近）加：
```tsx
{tab === 'ai' && <AiGenTab qc={qc} />}
```
文件内加子组件（顶部 import `AiVideoGenerator` 和 `ingestAiVideo`）：
```tsx
import { AiVideoGenerator } from '../../ai-video/AiVideoGenerator';
import { ingestAiVideo } from '../../ai-video/ingestAiVideo';
// ...
const AiGenTab: React.FC<{ qc: ReturnType<typeof useQueryClient> }> = ({ qc }) => {
  const onGenerated = async (url: string) => {
    try {
      await ingestAiVideo(url);
      await qc.invalidateQueries({ queryKey: ['vg.materials'] }); // 刷新「我的素材」
    } catch {
      /* 生成成功但落库失败:静默,用户可在 /ai-video 重试导入 */
    }
  };
  return (
    <div className="px-1 py-2">
      <p className="mb-2 text-[11px] text-[var(--cy-text-tertiary)]">
        用 AI 生成视频片段,生成后自动加入「我的素材」,拖到下方轨道即可使用。
      </p>
      <AiVideoGenerator compact onGenerated={(u) => void onGenerated(u)} />
    </div>
  );
};
```

- [ ] **Step 3: typecheck**
```bash
cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit
```
Expected: 0 error（注意 MaterialsStep 复用于向导 step5 + 时间轴编辑器素材池,改完两处都生效）。

---

## Task A5: 核实/启用后端 ingest 收 artifact URL

**Files:**
- Verify/Modify（条件）: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/materials.py`（`materials/ingest` 下载逻辑）

- [ ] **Step 1: 核实 ingest 能否下载 artifact URL**

读 `video_generation/api_server` 里 `materials/ingest` 路由 + `steps/materials.py` 的下载实现。确认给一个绝对的 `http://<host>:62581/v1/artifacts/<x>.mp4` 时能正常下载落库。
- 若它用 httpx/requests 直接 GET url → 能下载,**无需改后端**（A2 已把相对 URL 拼成绝对）。
- 若它对本地/artifact URL 有特殊处理或鉴权要求 → 加一小段：识别 `/v1/artifacts/` → 用 `artifacts` 模块把 URL 解析成本地文件路径,直接复制/登记为 material（免重复下载）。给该改动加 `ast.parse` 自检。

- [ ] **Step 2: 语法自检（若改了后端）**
```bash
cd /work/chayuan-desktop && python -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/materials.py').read()); print('ast.parse OK')"
```

（本任务以核实为主;改不改后端取决于核实结果。pytest 待 py312。）

---

## Task V1: 整体验收

- [ ] **Step 1: 前端全量 typecheck**
```bash
cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit
```
Expected: 两包 0 error。

- [ ] **Step 2: 重建 desktop + 重启 sidecar 人工实测**
- VG 编辑器/向导素材面板 → 「AI 生成」Tab → 选 Wanx + 提示词 → 生成 → 出现在「我的素材」→ 拖进 video 轨 → 合成出片含该 AI 片段。
- `/ai-video` 页 → 生成 → 「导入素材库」→ 到 VG「我的素材」能看到并拖用。
- I2V：传首帧图生成 → 同样落库可用。
- 回归：原 `/ai-video` 的生成/下载、素材面板原 4 Tab 不受影响。

---

## Self-Review（已核对 spec）

- **Spec 覆盖**：① 共享 AiVideoGenerator→A1；② ingestAiVideo→A2；③ 素材面板 AI Tab→A4；④ /ai-video 导入按钮→A3；⑤ AiVideoPage 重构→A1。后端 artifact ingest 核实→A5。
- **YAGNI 收敛**：砍了「AI Tab 一键加当前时间轴」（已在头部 + A4 说明,改走拖拽）。
- **占位扫描**：代码步给完整代码;「实现前先读 + 以实际为准」是既有大代码库的必要核对点（`getClientConfig`/`VgMaterial`/`vgIngestMedia` 真实签名、AiVideoPage 结果区位置、ingest 是否收 artifact URL）,已指明读哪个文件,非 TODO 占位。
- **类型一致**：`AiVideoGeneratorProps{onGenerated,compact}` A1 定义、A3/A4 使用一致;`ingestAiVideo(url)->VgMaterial` A2 定义、A3/A4 调用一致;素材刷新统一 `['vg.materials']`。
- **风险**：artifact URL ingest 需核实（A5 有兜底）;AiVideoPage 重构是行为敏感（搬迁后行为应等价,typecheck+实测双保险）。

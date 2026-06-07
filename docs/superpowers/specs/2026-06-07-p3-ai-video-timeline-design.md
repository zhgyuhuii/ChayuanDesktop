# P3：AI 文生/图生视频作为时间轴 clip 源 — Design Doc

- 日期：2026-06-07
- 范围：`chayuan-client`（VG 时间轴素材面板 + 独立 /ai-video 页 + 共享生成组件）；`chayuan-server`（artifact→material 落库，按需小改）
- 状态：已与用户对齐，待写 plan
- 前置：P1 的 `/ai-video` 页 + `aiVideo.ts`（`aiVideoGenerate`/`aiVideoListModels`）已上线；P1/P2 的视频连接器已就位（Wanx 实测可用）

## 背景与现状（已核对源码）

要把 AI 生成的视频用进 VG 时间轴，**基础设施已齐全**，主要缺一个「生成→落库→进时间轴」的入口：
- 时间轴 clip `source` 支持三选一：`{material_id}` / `{path}` / `{url}`（前端 `VgTimelineClip`@`packages/api/src/videoGeneration.ts` L60-87；后端 `TimelineClip`@`video_generation/schemas.py` L131-164）。
- 素材落库接口已存在：`vgIngestMedia({url, kind, source})`（`videoGeneration.ts` L666-676）→ 后端 `materials/ingest` 下载并建 `VgMaterialModel` 记录（`db/models/video_generation_model.py` L45-71）。
- 后端合成 `source_resolver`（`runner.py` L590-620）已能把 `material_id`→查库本地 path、`url`→下载、`path`→直通。EDL 渲染（`compose.py`）照常。
- 素材面板 `MaterialsStep`（`features/video-generation/steps/MaterialsStep.tsx`）已有 4 Tab：我的素材/在线搜索/从链接/上传；拖拽 MIME `application/x-vg-material`（`timeline/timelineEdit.ts` L174-315 `DraggedMaterial`/`appendClipFromMaterial`）；时间轴接 drop 在 `VgTimelineEditorPage.tsx` L117-122 `onDropMaterial`。
- `/ai-video` 页（`features/ai-video/AiVideoPage.tsx`）现状：生成完只 `<video>` + 下载，URL **无处可去**（`onVideo` 拿到 URL 但没后续）。它与时间轴**完全独立**。

> 结论：P3 不动时间轴/渲染管线,只新增「生成→落库→进时间轴」入口,并把生成表单做成可复用组件接两处。

## 设计

### ① 共享组件 `AiVideoGenerator`（真复用）

抽 `features/ai-video/AiVideoGenerator.tsx`：把 `AiVideoPage` 现有生成表单（模型下拉 `aiVideoListModels` + 提示词 textarea + 可选首帧图上传(I2V) + 时长/分辨率/比例 + `useUsageGate('video')` + `aiVideoGenerate` 进度）抽进来。
- props：`onGenerated?(videoUrl: string): void`（成功回调,把 artifact 视频 URL 抛出）、可选 `compact?: boolean`(嵌素材面板时紧凑布局)。
- 内部管理 model/prompt/image/params/progress/error/busy + AbortController。
- 自带进度条 + 结果 `<video>` 预览。

### ② 共享「落库」`ingestAiVideo`

`features/ai-video/ingestAiVideo.ts`（或并入 AiVideoGenerator）：
```
async ingestAiVideo(url): Promise<VgMaterial>
  return vgIngestMedia({ url, kind: 'video', source: 'ai-video' })
```
- ⚠️ **待核实(实现时先验)**：`vgIngestMedia`/后端 `materials/ingest` 能否吃本地 artifact URL（连接器把视频存 artifacts,`file_part` 给的是 `/v1/artifacts/...`）。
  - 若 ingest 走 http(s) 下载：传**绝对** artifact URL（拼 baseURL）即可,会从本地服务再下载一遍（可接受）。
  - 优化（按需）：后端 `materials/ingest` 识别 artifact URL → 直接解析成本地文件登记为 material,免重复下载。先按「绝对 URL 下载」实现,落库成功即达标;优化作为 follow-up。

### ③ 入口一：素材面板「AI 生成」Tab

`MaterialsStep` 加第 5 个 Tab「AI 生成」：
- 内容 = `<AiVideoGenerator compact onGenerated={handleAiGenerated} />`。
- `handleAiGenerated(url)`：`await ingestAiVideo(url)` → 得 `VgMaterial` → invalidate 我的素材列表 query（新片段出现在「我的素材」）→ toast「已生成并加入素材库」。
- 再给一键「加到当前时间轴」：用 `DraggedMaterial{materialId, kind:'video', durationMs}` 调 `appendClipFromMaterial`（复用现有逻辑,落到当前 video 轨末尾）。
- 用户也可照常从「我的素材」拖进轨道（零额外逻辑）。

### ④ 入口二：独立 `/ai-video` 页「导入素材库」

`AiVideoPage` 改用 `<AiVideoGenerator onGenerated={...} />`；生成完结果区在「下载」旁加「导入素材库」按钮 → `ingestAiVideo(url)` → toast「已导入,可在视频编辑→素材库里使用」。
- 不做直接「加到时间轴」：独立页无「当前时间轴」上下文,落库后用户到 VG 编辑器「我的素材」里取用。

### ⑤ AiVideoPage 重构

`AiVideoPage` 删掉自有表单逻辑,改为壳 + `<AiVideoGenerator>` + 结果区（下载/导入素材库）。消除与 Tab 的重复。

### 不动

时间轴数据结构、`appendClipFromMaterial`、`source_resolver`、EDL 渲染（已天然支持 material_id）、连接器。

## 验证

- 前端：`node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit` + `packages/api`。
- 后端（若改 `materials/ingest`）：`ast.parse` + 相关 pytest（待 py312 机器）。
- 人工实测（重建 desktop + 重启 sidecar）：
  - VG 编辑器素材面板「AI 生成」Tab → 输入提示词选 Wanx → 生成 → 出现在「我的素材」→ 拖进轨道 → 合成出片含该 AI 片段。
  - `/ai-video` 页生成 → 「导入素材库」→ 到 VG 编辑器「我的素材」能看到并使用。
  - I2V：传首帧图生成 → 同样落库可用。

## 已知风险

- artifact URL 能否被 `materials/ingest` 摄取需先验（见 ②）；最坏情况加一小段后端「artifact→本地 path 登记」。
- AI 生成是异步长任务（30-120s），素材面板 Tab 里要让用户能切走/等待,生成中给清晰进度（复用 AiVideoGenerator 的进度条）。
- 计费：AI 生成计 `video` 按次（`useUsageGate('video')`，已有）。两个入口都过同一门控,避免重复计费需注意（每次生成各计一次,符合预期）。
- 视频时长：ingest 后 material 的 `duration_ms` 要正确（后端 ingest 探测时长;若没探到,前端 `probeVideoDuration` 兜底,现有逻辑已有）。

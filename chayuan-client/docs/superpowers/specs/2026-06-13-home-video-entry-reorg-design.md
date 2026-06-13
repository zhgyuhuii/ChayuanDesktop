# 主页视频入口重排 + AI视频生成对话化 + t2v/i2v 区分 + 下载统一

> 日期:2026-06-13 · 范围:chayuan-client(前端为主,后端不动)

## 1. 背景与目标

当前「视频」相关入口混乱:左侧菜单有「AI视频生成」(`/ai-video` 表单),主页有「视频生成」块(`/video-generation` 对话式 pipeline),主页能力卡区还有「文生视频」卡(对话式 t2v)。三者命名重叠、职责不清,且选中图生视频(i2v)模型时报 `Field required: input.media`。

本设计要:
1. 主页功能入口重排成 8 块、2 行 × 4 列。
2. 隐藏左侧菜单「AI视频生成」,把它收敛到主页块,且改成「对话为主 + 表单做高级模式」。
3. 区分 t2v / i2v 模型,根治 `input.media` 报错(前端根治)。
4. 所有「生成出来的」图像/视频统一加下载按钮,走原生保存。

## 2. 产品分析:三类视频产品

| 类 | 实现 | 形态 | 做什么 |
|---|---|---|---|
| **A 图文成片** | `/video-generation` VgChatPage | 对话式 pipeline | 主题→文案→TTS→字幕→素材→合成,产出口播/图文解说视频 |
| **B AI视频生成** | diffusion t2v/i2v(`/ai-video` 表单 + 「文生视频」能力卡) | 对话为主 + 表单高级模式 | 模型直接生成画面(文生视频 / 图生视频) |
| C 数字人 / D 视频编辑 | digital-human / timeline | — | 形象口播 / 时间轴剪辑 |

A 与 B 是两个不同产品,分别成块。B 现有「表单 + 能力卡」两套,本设计统一到主页块(对话)+ 高级模式(复用表单)。

## 3. 命名与布局(已与用户确认)

- A = **图文成片**(副标题:输入主题,自动配音 + 字幕 + 素材合成)
- B = **AI视频生成**(副标题:文生 / 图生视频,AI 直接生成画面)

主页 8 块,2 行 × 4 列:
```
第1行(理解/记录):  知识库     图转文     音转文     AI笔记
第2行(视频创作):  AI视频生成  图文成片   数字人     视频编辑
```

## 4. 分项设计

### ① 主页 8 块布局
- 文件:`packages/app/src/features/home/HomePage.tsx`
- 改 `CAPS` 数组(现 7 项,53-117 行):
  - 新增 `ai-video` 块(title「AI视频生成」,icon `Wand2`,触发对话式 t2v,见 ③)。
  - 把原 `video-generation` 块 title「视频生成」→「图文成片」(图标 Clapperboard 保留,route `/video-generation` 不变)。
  - 顺序调整为:知识库 / 图转文 / 音转文 / AI笔记 / AI视频生成 / 图文成片 / 数字人 / 视频编辑。
- 网格容器(294 行)列数:`grid-cols-3 sm:grid-cols-4 lg:grid-cols-7` → `grid-cols-2 sm:grid-cols-4`(固定一行 4 个、两行)。
- 顺手修过时注释(6/17 行「5 个工具卡」)。
- 能力卡区「文生视频」卡**保留**(用户确认),与 AI视频生成块并存。

### ② 隐藏左侧菜单「AI视频生成」
- 文件:`packages/app/src/features/shell/Sidebar.tsx`,`NAV_ITEMS`(83 行)删除 `/ai-video` 项。
- `page-registry.tsx` 的 `/ai-video` 路由**保留**(高级模式仍可能用到;即使不导航也无害)。

### ③ AI视频生成块 = 对话为主 + 表单高级模式
- **对话入口**:主页「AI视频生成」块点击 → 复用 `startCapabilityChat({cap:'t2v'})`(`features/home/capabilityCards/startCapabilityChat.ts`),开一个 t2v 对话(/chat,T2V_MODE)。需在 `HomePage.onCapClick` 里对 `id==='ai-video'` 走该分支而非普通 navigate。
- **高级模式**:在 t2v/i2v 对话参数条 `VideoGenParamBar.tsx` 加「高级模式」按钮 → 打开一个 Dialog,内嵌现成 `<AiVideoGenerator compact />`(组件已支持 compact,真复用,不自造)。两条路 body 同构(都打 `/v1/modality/completions`)。

### ④ 区分 t2v / i2v(前端根治 input.media)
根因:i2v 模型在全栈被归类成 t2v,而 T2V_MODE `attachmentRule:'forbidden'` 禁止传图 → i2v 拿不到必填首帧图 → 上游报 `Field required: input.media`。后端只做转发,无需动后端。
- `packages/transport/src/modality-stream.ts`:`ModalityCapability` 加 `'i2v'`(31-41 行);name→cap 映射(53 行)把 i2v 名(含 `i2v`/`image2video`)判成 `'i2v'`。
- `packages/app/src/features/composer/modelCapabilityChip.tsx`:CAP_META 加 i2v(label「图生视频」);`inferCapability` 把 i2v 名判成 `i2v`;INTERACTIVE_CAPABILITIES 含 i2v。
- `packages/app/src/features/composer/composerMode.ts`:新增 `I2V_MODE`(capability `i2v`,attachmentRule **required**,paramKind `video_size_dur`,backendPath `modality`,label「图生视频」);cap→mode 映射补 i2v。
- 模型下拉(`ComposerModelPill.tsx` / `ModelMenuList.tsx`):t2v 与 i2v **分组/标注**,不再混。选 i2v → I2V_MODE(强制上传首帧图);选 t2v → 不传图。
- 表单高级模式 `AiVideoGenerator.tsx`:选 i2v 时参考图**必填**、t2v 时隐藏参考图。`aiVideoListModels` 区分 i2v/t2v。
- i2v 判定来源:模型名启发式(含 `i2v`/`image2video`)+ 现有 name→cap 映射(catalog 暂无 image2video_models 字段,前端根治不依赖后端字段)。

### ⑤ 下载按钮统一
- 标准:`getPlatform().fs.saveBinary(name, blob)`(原生保存对话框);范例 `VideoLibraryPage.tsx:300-316`。
- 修改点:
  - 对话内生成图 `features/chat/parts/ImageCard.tsx`(47-63 行的 fetch+`<a download>` → saveBinary)。
  - 数字人 `DhTaskList.tsx:130`、`DhProgressCard.tsx`、`kb/detail/ImageKbDetail.tsx:832`(视频 `<a download>` → saveBinary)。
  - 表单结果视频 `AiVideoGenerator.tsx`(`<a href download>` → saveBinary)。
- 不加:图转文/img2video/数字人里的「输入图」(非生成产物)。

## 5. 分阶段实施(每阶段给用户审 + typecheck)

- **Phase 1(纯 UI,低风险)**:① 主页布局+命名、② 隐藏左菜单、⑤ 下载统一。
- **Phase 2**:③ AI视频生成对话入口 + 高级模式 Dialog。
- **Phase 3**:④ t2v/i2v 区分(前端根治报错)。

## 6. 范围外 / 风险

- 后端不动(`/v1/modality/completions` 仅转发)。彻底版的后端 i2v capability 注册不在本次范围。
- chayuan-server 仓存在标识符乱码,故刻意避免后端改动。
- i2v 判定靠模型名启发式,若有命名不规范的 i2v 模型可能漏判;后续可由 catalog 增 `image2video_models` 字段根治(范围外)。
- 「文生视频」能力卡与 AI视频生成块并存(用户选择保留),功能略重叠但导航语境不同。

## 7. 验证

- 每阶段 `cd chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit`。
- 手测:主页 8 块布局;点 AI视频生成进对话;选 i2v 模型要求传图且不再报 input.media;选 t2v 不传图;生成图/视频下载按钮可保存。
- 前端改动需重建 desktop + 重启 sidecar 才能在客户端看到。

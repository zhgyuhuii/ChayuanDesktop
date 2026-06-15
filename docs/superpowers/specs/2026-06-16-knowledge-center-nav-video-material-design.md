# 知识中心导航 + 素材中心 + 视频中心整合 设计

日期:2026-06-16  状态:已与用户确认四项决策,待落实施 plan

## 背景与目标

把「素材」「视频」两个能力抽到主页左侧菜单,归入现有「知识中心」(现 `/kb` 项的
label 已是「知识中心」)之下,形成「知识中心 ▼ → 知识库 / 素材中心 / 视频中心」的
可展开父子菜单。其中:
- 素材中心 = 复用已存在的独立页 `MaterialLibraryPage`(路由 `/video-generation/materials`)。
- 视频中心 = 新建统一页,把「图文成片」(VG, `listVideos` → `VgVideo`)与
  「数字人视频」(DH, `listTasks` → `DhTaskStatus`)整合为一个页面。

## 用户已确认的四项决策

1. 菜单结构:把「知识中心」做成**可展开父菜单**,下挂 知识库 / 素材中心 / 视频中心。
2. 素材菜单名:**素材中心**。
3. 视频菜单名:**视频中心**。
4. 视频整合方式:**统一网格 + 进行中独立区**(已完成的成片+数字人按时间混排成
   一个网格、卡片带来源徽标;数字人「生成中/失败」任务放页面顶部独立区)。

## 命名与路由(最终)

| 层级 | 名称 | 路由 | 来源 |
|---|---|---|---|
| 父(展开/折叠,不导航) | 知识中心 | — | 新分组(label 复用 nav.knowledge='知识中心') |
| └ 子 | 知识库 | `/kb` | 现有 KbBoard(新 label key nav.knowledgeBase='知识库') |
| └ 子 | 素材中心 | `/video-generation/materials` | 复用 MaterialLibraryPage(页标题改素材中心) |
| └ 子 | 视频中心 | `/video-generation/videos`(新) | 新建 VideoCenterPage |

旧 `/video-generation/library`(我的视频)保留可达不破坏;菜单与各"看视频"入口统一
指向视频中心。

## 架构

### A. 侧边栏可展开父菜单(Sidebar.tsx)

- `NavItem` 增加可选 `children?: NavItem[]`、`group?: true`(group 项纯 toggle 不导航)。
- 把现有 `{ to:'/kb', labelKey:'nav.knowledge' }` 改为 group 项 `知识中心`,children =
  [ 知识库(/kb)、素材中心(/video-generation/materials)、视频中心(/video-generation/videos) ]。
- 渲染:展开态(!collapsed)group 项显示「图标 + 名称 + ▾ 箭头」,点击 toggle 展开;
  children 缩进一级渲染、命中当前路由高亮。展开状态持久化 localStorage
  (key `sidebar.kc.expanded`,默认展开)。
- 折叠态(collapsed,icon-only):一级 group 仍显示图标;hover 用 Radix Popover 弹出
  children 列表(项目既有 Popover 用法)。本期若折叠态实现成本高,可先令折叠态点击
  group 直接跳第一个子项(知识库),Popover 作为后续增强 —— 实施时择优,不留 TODO 黑洞。

### B. 素材中心

零新页:菜单子项指向已存在 `MaterialLibraryPage`。仅把页内 H1「素材库」与
page-registry defaultTitle 改为「素材中心」。功能(grid/list、来源筛选、多选删除)不动。

### C. 视频中心(新页 VideoCenterPage + hook useUnifiedVideos)

数据归一 hook `useUnifiedVideos()`:并行 `listVideos()` + `listTasks()`,映射成统一模型:

```ts
type UnifiedVideo = {
  key: string;                 // `vg:${video_id}` / `dh:${task_id}`
  source: 'vg' | 'dh';
  title: string;
  fileUrl: string;             // 播放/下载地址(vgTaskFileUrl / dhTaskFileUrl)
  durationMs: number;
  createdAt: number;           // 统一毫秒(dh.created_at 是秒 → ×1000)
  width?: number; height?: number;
  state: 'complete' | 'processing' | 'failed' | 'canceled';
  progress?: number;           // 仅 dh 进行中
  raw: VgVideo | DhTaskStatus;
};
```

- VG 视频一律 state='complete'(成片表里都是已完成);createdAt 直接用 ms。
- DH:state 用 task.state;createdAt = (task.created_at ?? 0)*1000;fileUrl 用
  `digitalHuman.taskFileUrl(task_id)`;进行中无 fileUrl。
- 轮询:仅当存在 active(state==processing)DH 任务时,对 `dh.tasks` 开 3s refetch;
  否则 staleTime 30s。`vg.videos` staleTime 30s。

页面布局:
- 顶部 header:标题「视频中心」+ 视图切换(card/list)+ 多选(沿用 VideoLibraryPage)。
- 筛选 chips:全部 / 图文成片 / 数字人(过滤已完成网格的来源)。
- 「生成中」独立区:DH 中 state≠complete 的任务(进度/失败),复用 DhProgressCard 或
  精简卡;无进行中任务时整区隐藏。
- 统一网格:已完成 VG + 已完成 DH,按 createdAt 倒序混排;每卡右上来源徽标
  (图文成片 / 数字人)。card/list 两视图沿用 VideoLibraryPage 风格。
- 操作按来源适配:
  - VG:播放、下载、删除(deleteVideo drop_file)、复制参数重做(写回 vgComposer)。
  - DH:播放、下载、删除(deleteTask)。无"重做"。
- 复用:抽出与来源无关的卡片骨架;VG 专属(脚本/字幕/重做)与 DH 专属操作按 source 分支。

### D. 数字人页内「视频」tab

保留不动(DH 工作流内便捷查看)。视频中心是全局聚合入口。后续可选让该 tab 跳视频中心。

## 数据流

```
Sidebar(知识中心 group)
  └─ 视频中心 /video-generation/videos
       └─ VideoCenterPage
            └─ useUnifiedVideos()  ── listVideos()  (react-query: vg.videos)
                                   └─ listTasks()   (react-query: dh.tasks, 条件 3s 轮询)
            → 归一 UnifiedVideo[] → 分区(active / completed)→ 筛选 → 渲染
```

## 错误处理

- 任一来源加载失败:该来源置空 + 顶部提示「图文成片/数字人 加载失败」,另一来源照常显示。
- 删除失败:reportError,不影响列表。
- 文件 URL 缺失(DH 进行中):不渲染播放/下载,只显进度。

## 测试

- vitest:`useUnifiedVideos` 的纯函数部分(归一映射 normalizeVg/normalizeDh、createdAt
  秒→毫秒、active/completed 分区、source 筛选、混排倒序)。抽成可单测的纯函数
  `mergeUnifiedVideos(videos, tasks)`。
- `npm run typecheck`(packages/app + api 合同一致)。
- 不碰后端,无新增端点。

## 分期实施

- P1:Sidebar 可展开父菜单(知识中心 group + children + 展开持久化 + 折叠态处理)
  + 素材中心命名 + i18n keys + page-registry 新增 `/video-generation/videos` 路由占位。
- P2:`mergeUnifiedVideos` 纯函数 + vitest;`useUnifiedVideos` hook(条件轮询)。
- P3:VideoCenterPage(生成中区 / 混排网格 / 来源徽标 / 筛选 chips / card-list 视图 /
  按来源操作);复用 VideoLibraryPage 卡片骨架与 DH 操作。
- P4:各处"看视频"入口指向视频中心 + typecheck + 自测。

## 风险

- 折叠态二级菜单交互(Popover)在 WebKitGTK/Tauri 的表现需真机验证。
- DH 进行中任务的进度卡复用(DhProgressCard 依赖 dh.tasks query)需确认无副作用。
- 真机需重建 desktop + 重启 sidecar 才能看到整合效果。

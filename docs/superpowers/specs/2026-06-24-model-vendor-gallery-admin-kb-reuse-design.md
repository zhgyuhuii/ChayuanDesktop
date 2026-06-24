# 模型厂商重命名 + 模型广场进后台 + 后台知识库复用前端 — 设计

日期:2026-06-24 · 状态:已确认(用户拍板)

## 背景与目标
1. 前端「模型」菜单改叫「模型厂商」,前后端统一叫法。
2. 模型广场(下载模型)也要能在管理员后台使用,管理员进后台可下载模型。
3. 后台「知识库管理」与前端「知识中心 > 知识库」功能一致 —— 复用前端整套
   `KbBoard` + `KbDetailPage`,并叠加管理员专属能力。

## Part 1 — 「模型」→「模型厂商」
- `packages/i18n/src/locales/zh-CN.ts`:`nav.modelMarket` 由 `'模型'` 改 `'模型厂商'`
  (其余语言早已是 Model Vendors/モデルベンダー;`/marketplace` tab 标题用同一 key,自动跟改)。
- `features/admin/AdminPage.tsx`:`{ key:'platforms', label:'模型平台' }` → `'模型厂商'`。
- 纯文案,无逻辑改动。

## Part 2 — 模型广场进后台(复用 ModelGalleryPage)
- `ModelGalleryPage` 加 `embedded?: boolean`(照搬 MarketplacePage 范式:embedded 时
  去掉外层 `px-6 py-5` 页面外壳/大标题,贴合后台内容区)。
- `AdminPage`:`AdminTab` 增 `'gallery'`;「模型与服务」组在「模型厂商」之后加
  `{ key:'gallery', label:'模型广场', icon: Store }`;渲染 `{tab==='gallery' && <ModelGalleryPage embedded />}`;
  `KNOWN_TABS` 自动含(由 ADMIN_GROUPS 派生)。
- 下载链路:ModelGalleryPage 安装走 `/admin/models/install_model` 等(已 admin 门控),后台可下载。

## Part 3 — 后台知识库 = 前端 KbBoard + KbDetailPage + 管理员能力
### KbBoard 加 `adminMode?: boolean`
- 数据源不变:`knowledgeUniverse.list()` 对 admin 后端本就返回全部 KB。
- 卡片/视图切换/上传/新建(KbCreateFlow)照常,与前端一致。
- 打开详情:前端走 `openTab('/kb/:id')`;adminMode 无 tabs,改置本地 `detailKuId` state,
  内联渲染 `<KbDetailPage kuId adminMode onBack/>`(列表↔详情本地切换)。

### KbDetailPage 加 `adminMode?: boolean` + `onBack?`
- 复用文件列表 + 预览(与前端一致)。
- adminMode **隐藏库内对话**(ConversationView 依赖 composer/tabs/preview 工作区 store,
  后台控制台无此基设,集成风险大;后台定位是「管理」)。
- adminMode 叠加管理员面板:可见性 / owner / 授权(复用 kbAcl + GrantsDialog)+
  分片查看/编辑/删除/重向量化(从旧 KbManagePage 搬入)。

### 退役旧页
- `{tab==='kbmanage'}` 改渲染 `<KbBoard adminMode />`;删 `admin/kbmanage/KbManagePage.tsx`
  (GrantsDialog 继续复用)。

## 非目标 / 保留
- 不改后端 KB 接口契约;admin 全量可见沿用现有 `knowledgeUniverse.list()` 行为。
- 分片编辑/授权等管理能力沿用现有 kbAcl / kb.listFileChunks/saveFileChunks 接口。

## 验证
- `npm run typecheck`(需 node 环境;本沙箱无 node,提交时如实标注)。
- 前端需重新构建并重启才生效。

## 里程碑
- M1:Part 1 + Part 2(低风险快赢)。
- M2:Part 3 — KbBoard adminMode + KbDetailPage adminMode + 退役 KbManagePage。

---

## M2 执行计划(已确认:抽取共享详情体)

> 背景修正:KbBoard / KbDetailPage 均为 chat-first(主面板是会话),不能整体嵌后台。
> 改为抽取「文件列表 + 预览 + 上传」这条与对话无关的详情体,两端共用。

### Step 1 — 抽取共享详情体(零行为变更,先保前端不回归)
- 新建 `features/kb/detail/KbFilesBody.tsx`:把 KbDetailPage 里**与对话无关**的部分搬出:
  文件列表(slot A)+ 拖拽上传(KbDropZone)+ `<PreviewPanel embedded />`(右列)+
  文件选择/刷新逻辑。props:`{ detail, canWrite, onMutate, rightSlot?: ReactNode }`。
- KbDetailPage 改为:Header + DetailLayoutSwitch + `<KbFilesBody ... rightSlot={<ConversationView/>}>`,
  对话相关 state(convId/chatCollapsed/composer)仍留在 KbDetailPage。
- 验收:前端 /kb 详情行为、布局、折叠完全不变(纯抽取)。

### Step 2 — 后台详情用共享体 + 管理面板(无对话)
- 新建 `features/admin/kbmanage/KbAdminDetail.tsx`:`<KbFilesBody detail ... rightSlot={<管理面板/>}>`,
  管理面板 = 可见性/owner/授权(kbAcl + GrantsDialog)+ 分片查看/编辑/删除/重向量化
  (从旧 KbManagePage 详情搬入)。无 ConversationView。
- KbManagePage:网格(已复用 KbCard)保留;点卡片 → 渲染 `<KbAdminDetail kuId onBack/>`,
  替掉原有的自实现内联详情。

### Step 3 — 收尾
- 删旧 KbManagePage 里被取代的内联文件/分片块;GrantsDialog 继续复用。
- typecheck(需 node 环境)。

### 风险与回归保护
- Step 1 是纯抽取,必须先保证前端 /kb 详情零行为变更再进 Step 2。
- KbFilesBody 不得引入 composer/tabs 依赖(对话相关留在 KbDetailPage),保证后台可干净复用。

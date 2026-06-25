# 知识库详情页文件列表:卡片化 + 服务端分页 + 无限滚动

- 日期:2026-06-25
- 状态:设计已确认,待写实施计划

## 背景与问题

知识库详情页(`KbDetailPage`)在「文件列表 + 对话框同时存在」时,左侧文件列表被压成 `w-72`(272px)窄列。当前文件列表是 `<table>`(列:勾选/图标/文件名/入库状态/大小/操作),窄列下 `操作` 列(w-28)挤占空间、状态/大小列按**视口**断点(`md:`)而非容器宽度隐藏,导致**表头错位、文件名看不全**(用户报的「知识库列表表头错乱」实为此处)。文件数据是 `detail.files` 一次性全量数组,前端只做本地关键词过滤,无分页——大知识库(几千文件)一次性渲染也吃力。

## 目标

1. 文件列表与对话框共存(窄列)时,**以卡片形式纵向展示**,避免错位/看不全;下滑到底**自动加载下一页**。
2. 文件列表改**真服务端分页**(支持几千文件),关键词搜索也走服务端。
3. 宽列(对话折叠、文件列表占满)保留现有表格形态,只是数据源同样走分页查询。

## 非目标(本期不做)

- 底层 DB 级游标分页(v1 在端点层基于 `get_kb_file_details` 全量切片;若 file-details 计算本身成为瓶颈,作为后续优化)。
- 改动知识库**列表页**(那是卡片/按钮布局,无表头,不在本次范围)。
- 宽列改卡片(按用户原话:仅共存窄列时卡片化)。

## 设计

### A. 后端:文件列表分页

扩展 `GET /knowledge_base/list_files`(`kb_doc_api.py`),新增**可选** query 参数:
- `page: int = 0`、`page_size: int = 0`、`keyword: str = ""`。
- **不传(page_size<=0)→ 原样返回全量** `ListResponse(data=all_docs)`(向后兼容,现有调用方零影响)。
- **传了 → 返回分页结构**:
  ```json
  { "code": 200, "data": { "items": [DocumentFile...], "total": N,
    "page": P, "page_size": S, "has_more": bool } }
  ```
- 内部:`get_kb_file_details(kb)` 取全量 → 按 `keyword`(对 file_name 子串,大小写不敏感)过滤 → 按 `page/page_size` 切片 → 计算 `total` / `has_more`。
- `DocumentFile` 字段沿用现有:`file_name` / `file_size` / `in_db` / `doc_count`。

新增 API 客户端方法(`packages/api`):`listFilesPaged(kbName, {page, pageSize, keyword}) -> {items, total, page, pageSize, hasMore}`。

### B. 前端组件

1. **`FileCard`**(新,`features/kb/detail/FileCard.tsx`):复用 `KbCard` 的边框/hover/阴影/chip 视觉套路,展示:
   - 文件图标 + 文件名(可换行/截断 title)
   - 入库状态 chip(已入库/未入库)+ 块数(doc_count)+ 大小(file_size 人类可读)
   - 操作按钮组:预览 / 下载 / 总结全文 / 切片 / 重建向量 / 删除(与现有 `FileRow` 同一套回调,按 `mine`/`onSummarizeFile` 等 prop 显隐)
   - 勾选 checkbox(多选,与表格一致)

2. **分页查询 hook**(新,`useKbFilesPaged.ts`):基于 React Query `useInfiniteQuery`,`queryKey=['kb.files.paged', kbName, keyword]`,`queryFn` 调 `listFilesPaged`,`getNextPageParam` 用 `has_more` + 下一 `page`。暴露 `items`(已 flatten)、`fetchNextPage`、`hasNextPage`、`isFetchingNextPage`、`total`。

3. **无限滚动哨兵**:列表底部放一个 sentinel `<div>`,用 `IntersectionObserver`(在 hook 内或独立 `useInfiniteScroll`)观察,进入视口且 `hasNextPage && !isFetchingNextPage` 时 `fetchNextPage()`。

### C. `DocumentKbDetail` 接入 + 窄列信号

- `KbDetailPage` 给 `DocumentKbDetail` 传 `narrow?: boolean`,值 = `inChatMode && !bodyCollapsed && !chatCollapsed`(即文件列表处于 `w-72` 窄列态)。
- `DocumentKbDetail`:
  - 文件列表数据源**从 `detail.files` 改为 `useKbFilesPaged(kbName, keyword)`**(宽窄统一)。
  - 关键词搜索框 → 受控,作为 hook 的 `keyword` 参数(服务端过滤,300ms 防抖)。
  - 渲染分支:
    - `narrow` → `<FileCard>` 纵向堆叠(`flex flex-col gap-2`)+ 底部哨兵,容器 `overflow-y-auto`。
    - 非 `narrow` → 现有 `<table>/<FileRow>`,tbody 末尾同样接哨兵(下滑加载下一页)。
  - 顶部显示 `total`(如「共 N 个文件」)。
  - 上传/删除/重建等 mutation 成功后 `invalidateQueries(['kb.files.paged', kbName])` 刷新。
- KbDetailPage 里原 `useQuery(['kb.files.summary', kbName])`(NL 意图检测拿文件名)**保持不变**(它要全量文件名做匹配,继续用全量 `listFiles`,不分页)。

## 风险与取舍

- 数据源从 `detail.files` 切到分页查询:需确保上传/删除/状态变化后正确 invalidate;`detail` 仍返回 files 但列表不再用它(避免双源不一致)。
- v1 端点层全量切片:结果正确、契约是分页,但未减少 `get_kb_file_details` 的计算量;真·大库优化留后续。
- 关键词改服务端:防抖避免每键一次请求。
- `IntersectionObserver` 在窄列容器内需正确指定 `root`(滚动容器),否则哨兵可能不触发。

## 测试与验证

- **后端**(py312/py3.11):`list_files` 分页单测——不传参=全量(回归);传 `page/page_size/keyword`=正确切片 + `total`/`has_more` 准确;keyword 过滤命中。
- **前端**:`npm run typecheck`;`FileCard` 渲染字段/按钮显隐;hook 的 `getNextPageParam` 逻辑(vitest,可 mock listFilesPaged)。
- **真机**:窄列共存 → 卡片纵向、下滑自动加载;宽列 → 表格 + 下滑加载;搜索过滤正确;大库不卡顿;上传/删除后刷新。

## 验收标准

1. 文件列表 + 对话框共存时,文件以卡片纵向展示,无错位/截断,可上下滚动。
2. 下滑到底自动加载下一页(服务端分页)。
3. 关键词搜索走服务端,跨页生效。
4. 宽列保留表格,行为不回归。
5. `list_files` 不传分页参数时全量返回不变(其它调用方零影响)。

# 知识库全文总结重构设计（点击触发 + 持久缓存 + 分级 + 复用 RAPTOR）

- 日期：2026-06-26
- 范围：`chayuan-server`（后端总结链路）+ `chayuan-client`（KB 详情页总结调用）
- 状态：设计已与用户确认方向、分期（P1 先行）、Tier 3 阈值（chunk > 200）

## 1. 背景与问题

用户主诉：知识库"全文总结"**效率完全无法走通**。实测场景 = **几页小文档 + 云端模型 + 慢到不可用 + 同一文件再点又慢一遍**。

当前实现并不原始，已有：单次整篇流式（`reduce_llm.stream()`）、map-reduce 兜底（`budgeted_reduce.summarize_budgeted`）、token 预算化（`token_budget.py`）、内容哈希缓存（`_SummaryCacheStore` + `file_summary_cache`）、进度帧、15min 硬超时。链路：

- 端点 `chayuan-server/libs/chayuan-server/chayuan/server/api_server/kb_routes.py:1660`（`summarize_file_now_endpoint`）
- 核心 `.../knowledge_base/kb_summary_api.py:311`（`summarize_file_now`）

### 1.1 真因诊断（已坐实）

| # | 故障 | 证据 | 后果 |
|---|---|---|---|
| **1（主因）** | 缓存键不稳定 → 永不命中 | `list_docs_from_db`（`db/repository/knowledge_file_repository.py:50,56`）是 `session.query(FileDocModel).filter(...).all()`，**无 `ORDER BY`**；`content_hash`（`kb_summary/cache_key.py`）却"按给定顺序"对 chunk 文本算哈希 → PostgreSQL 无序查询导致顺序漂移 → key 漂移 → 缓存永不命中 | 每次点都全量重算（用户实测"又慢一遍"） |
| **2（放大）** | 小文档没走单次快路径 | `resolve_model_ctx`（`kb_summary/token_budget.py`）在 model_name 解析不到真实 ctx 时退回 `DEFAULT_CTX=4096`；几页文档（估算 > 单次预算 2976 token）被迫 map-reduce | 单次重算从"1 次云端调用 ~5s"退化成"3 次 ~26s" |

**净效果**：每次总结 = 一次完整云端代价、且无限重复 → 几页小文档也慢到不可用。

### 1.2 根本认知

「按需实时总结」把"用户每次都等一遍云端 + 依赖一个现在还坏着的缓存"绑在一起。真正"走通"的方式是**让计算只发生一次、之后只读缓存**，并按文档规模分级选最省的总结武器。超长文档（几十万字/几万页）是经典难题，业界用**层次树（RAPTOR）+ 入库预计算**解决；本仓库已自带 RAPTOR 构建器可复用。

> 文本来源澄清：**语义检索（top-k）是"问答"工具，不是"总结"工具**——它按相关度取片段、天生漏内容；全文总结要全覆盖。故总结读"全量 chunk（按序）"，不读"语义 top-k"，不常态重解析 MinIO 原文（仅兜底）。

## 2. 目标 / 非目标

**目标**
- 同一文件总结**只算一次**，之后同内容**秒回**（修掉"又慢一遍"）。
- 几页/几万字文档**单次整篇秒出**（修掉被迫 map-reduce）。
- 几十万字/几万页文档**可被总结**（分级 + 按文件 RAPTOR）。

**非目标**
- 不改"按需点击触发"模型（用户明确选"点击才算"，不做入库后台预计算队列）。
- 不动 RAPTOR 的整库检索用途；只新增"按文件"变体。
- 不引入语义 top-k 做总结。

## 3. 设计

### 3.1 缓存键 = `file_hash`（根治"又慢一遍"）
- 键改为 `summary::{kb_name}::{file_name}::{file_hash}`。`file_hash` 已存在：`db/models/knowledge_file_model.py:21`（`KnowledgeFileModel.file_hash`，SHA-256，已建索引）。
- 内容变 → 重建索引刷新 `file_hash` → key 变 → 缓存自动失效。
- 历史文件 `file_hash` 为空时回退："按 `FileDocModel.id` 排序后的 chunk 文本哈希"（`content_hash` 仍可用，但喂入的 chunk 已稳定排序）。
- 写读两侧已闭合（`_SummaryCacheStore.search_by_key/put` → `list_summary_from_db/add_summary_to_db`，按 `meta_data["summary_key"]` 精确查），只需把传入的 key 换成稳定值。

### 3.2 文本来源 = 全量 chunk 按 `id` 排序
- `list_docs_from_db`（`knowledge_file_repository.py:40`）补 `.order_by(FileDocModel.id)`。`FileDocModel.id` 自增 = 入库即文档顺序（`knowledge_file_model.py:37`）。这同时修复全文拼接顺序与缓存哈希稳定性两件事。
- MinIO/对象存储原文重解析：仅当 chunk 缺失/不完整时兜底（P3）。

### 3.3 分级（按估算 token + 真实 ctx）
- 修 `resolve_model_ctx`：云端模型用 `model_metadata.context_length` 真实值（现成查询逻辑），确保前端把选中的模型名传到后端（见 3.6）。本地模型保持 4096 + 串行（必要妥协，不动）。
- **Tier 1 能塞下**（`fits_single_pass` 为真）→ 单次整篇 `reduce_llm.stream()` 流式（现成路径，`kb_summary_api.py:440-470`）。
- **Tier 2 超 ctx 中等** → 并行 map-reduce（现成 `budgeted_reduce.summarize_budgeted`，云端 `map_concurrency_for=4`）。
- **Tier 3 海量（chunk 数 > 200）** → 按文件 RAPTOR（见 3.4）。

### 3.4 Tier 3：按文件 RAPTOR
- 现状：`file_rag/raptor/builder.py:build_raptor_for_kb` 是**整库**粒度（`_load_level_docs(kb, level=0)` 读全 KB chunk、跨库聚类、写回向量库）。
- 新增**单文件变体**：输入该文件的 chunk（`kb.list_docs(file_name)` 按 id 序）→ 复用 `raptor/clustering.py:gmm_cluster` 聚类去冗余 → 逐簇调 summarizer → 递归到根 → **根节点即整篇摘要**。
- 与整库 RAPTOR 区别：不写回 KB 检索向量库（避免污染检索），只产出"该文件的根摘要"落总结缓存（按 file_hash）。
- 在用户二次确认后的那次点击算一次，结果按 file_hash 缓存。

### 3.5 触发 & 缓存 UX
- 点击 → 查缓存（file_hash）→ 命中：秒回（`cached:true`）；未命中：按 Tier 算（流式/进度同现状）→ `put_summary`。
- Tier 3 / 超大（chunk > threshold）→ 现成 `summarize_precheck` 的 `needs_confirm` 二次确认门（`kb_summary_api.py:366-380`），让用户对成本知情后再算。
- 取消/重试/超时：沿用现有 SSE 帧与 900s 硬超时。

### 3.6 前端
- `chayuan-client/packages/app/src/features/kb/detail/useFileSummaryTurn.ts:66` 已传 `model_name: modelId || undefined`。需确认 `KbDetailPage` 传入的 `modelId` 是用户选中的（云端）对话模型而非空/embedding 模型——否则后端 `model_name=None` → ctx 退 4096 → Tier 误判。P1 内核对并修正取值来源。

## 4. 分期（每期可单独验收）

**P1（核心，最大收益）**
1. 缓存键改用 `file_hash`（含历史回退）。
2. `list_docs_from_db` 加 `ORDER BY id`。
3. `resolve_model_ctx` 用云端真实 ctx；前端确保传选中模型名。
- 验收：同文件二次点击 `cached:true` 秒回；几页云端文档单次整篇流式、首次 ~数秒。

**P2**
- Tier 3 按文件 RAPTOR（chunk > 200 触发）。
- 验收：几十万字文档能在二次确认后产出根摘要并缓存。

**P3**
- MinIO 原文兜底（chunk 不完整时）+ re-index 自动清旧 summary（`drop`/失效联动）。

## 5. 测试与验证

- **后端单测**：`content_hash` 稳定性（同输入不同顺序→排序后同 key）；`resolve_model_ctx` 云端真实值；`summarize_precheck` 阈值；缓存命中 round-trip（put→search_by_key 同 key 命中）。按文件 RAPTOR 聚类→根摘要的桩测试。
- **真机**（沙箱不可跑 langchain/FAISS/LLM 真链路）：docker 网络版点击总结，验证首次/二次（缓存）/Tier 切换/needs_confirm。
- 命令参考：`PYTHONPATH=... pytest .../tests/unit_tests/test_kb_summary*.py`；前端 `npm run typecheck`。

## 6. 风险

- `file_hash` 历史为空的文件需回退路径，避免回退态又退化成不稳定 key（回退也要按 id 排序）。
- 云端 `context_length` 在 `model_metadata` 缺失时仍退 `CLOUD_DEFAULT_CTX`；需保证常用云端模型 metadata 有 ctx。
- 按文件 RAPTOR 的聚类成本与质量需真机校准（cluster_size、max_levels）。
- 前端 `modelId` 取值若来自错误来源，P1 的 ctx 修复会落空——必须核对。

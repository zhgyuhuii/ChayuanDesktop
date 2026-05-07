# 知识库查询接口架构与开发计划

## 1. 目标与边界

本计划设计一组面向外部调用和前端复用的知识库查询接口，覆盖两类核心能力：

1. 获取知识库清单：支持游客访问公开知识库，也支持登录用户通过 token 获取自己拥有、被授权或公开的知识库。
2. 查询知识库：支持传入知识库名称和一段或多段内容，服务端负责切分、并发检索、聚合和批量返回结果；返回结果必须带可追溯引用，包括文件链接、页码、chunk、结构化数据表名、数据 id 等。

现有代码已经具备 FastAPI、JWT 中间件、KB ACL、`/knowledge_universe/list`、`/knowledge_universe/ask`、文档 KB 检索、结构化 source、文件下载链接等基础能力。新接口不另起权限体系，优先复用：

- `AuthMiddleware`：解析 `Authorization: Bearer <token>` 和 HttpOnly cookie。
- `require_auth_enabled()` / optional user：兼容游客和强制登录部署。
- `auth.access.can_read_kb()` / `list_accessible_kbs()`：文档 KB 授权。
- `auth.source_access`：结构化 source 授权。
- `knowledge_universe_routes.py`：统一 `doc:*` / `src:*` / `office:*` 知识库标识和 dispatch 经验。
- `kb_doc_api.search_docs()`：文档 KB 检索，查询阶段固定使用 KB 创建或重建索引时记录的嵌入模型；外部 API 不暴露、不接收嵌入模型名称。
- `file_rag.result_envelope.to_wire_list()`：标准化文档引用结果。

## 2. 核心原则

- 权限先行：任何查询必须先解析调用者身份，再判断知识库可读权限；无权限资源返回 403，不参与检索。
- 游客可用：当系统未强制登录时，无 token 请求只返回 `public` 知识库；若请求携带有效 token，则额外合并 owner / grants 权限。
- 认证模式严格：当 `AUTH_REQUIRED=true` 时，清单和查询接口都必须带 token，否则返回 401。
- 内容“无业务上限”：接口不假设内容长度。短内容走同步批量返回；超大内容走流式上传或异步任务，服务端分块处理、背压控制、分批输出。
- 返回可追溯：每个命中都必须包含 `source_type`、`kb_name` / `source_id`、文件链接或结构化定位信息、score、metadata 和诊断信息。
- 模块化复用：新增 API 层只做协议适配，认证、授权、检索、引用构造、批处理分别收敛到独立服务。
- 高并发友好：检索按内容块和知识库并发，但使用 per-user、per-kb、全局并发阈值保护向量库、数据库和 LLM。
- 可移植：对向量库、对象存储、结构化库保持 adapter 抽象，避免业务接口绑定 Milvus / PG / MinIO 等具体实现。

## 3. 接口设计

### 3.1 获取知识库清单

新增接口：

```http
GET /api/v1/kb-query/knowledge-bases?kind=document,structured,image,vector&include_vector=false
Authorization: Bearer <access_token>  # 可选或必选，取决于 AUTH_REQUIRED
```

行为：

- `AUTH_REQUIRED=false` 且无 token：返回 `visibility=public` 的知识库。对于历史 `owner_id=NULL` 的 legacy KB，建议通过配置 `KB_LEGACY_GUEST_VISIBLE=false` 控制是否给游客可见，默认不暴露给匿名公网。
- `AUTH_REQUIRED=false` 且有 token：返回 public + owner + grant + legacy login visible。
- `AUTH_REQUIRED=true`：必须有 token，返回 public + owner + grant + legacy login visible。
- admin 返回全量。

响应示例：

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "kb_id": "doc:contract_kb",
      "name": "contract_kb",
      "display_name": "合同知识库",
      "kind": "document",
      "visibility": "public",
      "permission": "reader",
      "owner_id": 12,
      "file_count": 128,
      "retrieval_capabilities": ["vector", "hybrid", "rerank", "citation"],
      "created_at": "2026-04-30T12:00:00"
    },
    {
      "kb_id": "src:42",
      "name": "crm_mysql",
      "display_name": "CRM 数据库",
      "kind": "structured",
      "sub_kind": "sql",
      "visibility": "private",
      "permission": "reader",
      "tables": ["customer", "order"],
      "retrieval_capabilities": ["text2sql", "table_rows", "citation"]
    }
  ]
}
```

### 3.2 同步批量查询

适用于一般请求，建议限制单次 body 大小为可配置值，例如 10MB 或 50MB。这里的限制是网关和服务保护，不是业务语义上限。

```http
POST /api/v1/kb-query/search
Authorization: Bearer <access_token>  # 可选或必选，取决于 AUTH_REQUIRED
Content-Type: application/json
```

请求体：

```json
{
  "knowledge_base": "contract_kb",
  "kb_id": "doc:contract_kb",
  "contents": [
    {
      "content_id": "q1",
      "text": "查询甲方违约责任相关内容",
      "metadata": {"source": "user_input"}
    },
    {
      "content_id": "q2",
      "text": "客户 A 过去三个月的订单总额是多少"
    }
  ],
  "options": {
    "top_k": 8,
    "score_threshold": 0.5,
    "use_hybrid": true,
    "use_rerank": true,
    "rewrite_strategy": "auto",
    "return_diagnostics": true,
    "timeout_ms": 30000
  }
}
```

约束：

- `knowledge_base` 和 `kb_id` 二选一；优先使用 `kb_id`，兼容用知识库名称。
- `contents` 至少一项；每项建议有 `content_id`，没有则服务端生成。
- 外部请求体不定义 `embed_model`、`embedding_model`、`model_name_for_embedding` 等任何嵌入模型字段；服务端只能使用知识库创建或重建索引时记录的嵌入模型。
- 若旧客户端或第三方调用方额外传入嵌入模型字段，P0 阶段建议直接返回 400 `embedding_model_not_allowed`；兼容存量客户端时可临时忽略并记录审计告警，但不得改变实际检索模型。
- 游客无 token 时只能查询 public KB；登录用户必须有 reader 以上权限。

响应体：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "request_id": "req_01HX...",
    "kb_id": "doc:contract_kb",
    "name": "contract_kb",
    "kind": "document",
    "items": [
      {
        "content_id": "q1",
        "ok": true,
        "query": "查询甲方违约责任相关内容",
        "results": [
          {
            "hit_id": "hit_1",
            "source_type": "document",
            "score": 0.87,
            "text": "甲方未按约定付款的，应承担违约责任...",
            "citation": {
              "kb_id": "doc:contract_kb",
              "kb_name": "contract_kb",
              "file_name": "合同模板.pdf",
              "file_id": "file_123",
              "doc_id": "chunk_456",
              "page": 12,
              "chunk_id": "chunk_456",
              "download_url": "/knowledge_base/download_doc?knowledge_base_name=contract_kb&file_name=...",
              "preview_url": "/knowledge_base/preview_doc?knowledge_base_name=contract_kb&file_name=...",
              "metadata": {
                "section_path": ["第四章", "违约责任"],
                "char_offset_start": 1203,
                "char_offset_end": 1345
              }
            },
            "retrieval_path": "hybrid+rerank"
          }
        ],
        "diagnostic": {
          "rewritten_queries": ["查询甲方违约责任相关内容"],
          "retrieval_model_policy": "kb_bound_embedding",
          "elapsed_ms": 218
        }
      }
    ],
    "usage": {
      "content_count": 2,
      "success_count": 2,
      "failed_count": 0,
      "elapsed_ms": 645
    }
  }
}
```

结构化知识库响应中的 `citation` 改为结构化定位：

```json
{
  "source_type": "structured",
  "score": 0.91,
  "text": "客户 A 过去三个月订单总额为 128000 元",
  "citation": {
    "kb_id": "src:42",
    "source_id": 42,
    "source_name": "crm_mysql",
    "database": "crm",
    "schema": "public",
    "table": "orders",
    "primary_key": {"id": 10086},
    "row_ids": [10086, 10087],
    "sql": "SELECT ...",
    "columns": ["id", "customer_name", "amount"],
    "rows": [
      {"id": 10086, "customer_name": "客户A", "amount": 64000}
    ]
  }
}
```

### 3.3 超大内容异步查询

用于“内容无上限”的生产路径，避免一次性把所有内容读入内存。

```http
POST /api/v1/kb-query/search-jobs/ndjson
Authorization: Bearer <access_token>
Content-Type: application/x-ndjson
```

每行一个 JSON：

```json
{"knowledge_base":"contract_kb","content_id":"q1","text":"..."}
{"knowledge_base":"contract_kb","content_id":"q2","text":"..."}
```

响应：

```json
{
  "code": 0,
  "data": {
    "job_id": "kbq_01HX...",
    "status": "queued",
    "accepted_count": 100000
  }
}
```

查询任务状态：

```http
GET /api/v1/kb-query/search-jobs/{job_id}
```

流式读取结果：

```http
GET /api/v1/kb-query/search-jobs/{job_id}/events
Accept: text/event-stream
```

事件：

- `meta`：任务元信息。
- `item`：单条内容查询完成。
- `progress`：进度。
- `error`：单条或任务级错误。
- `done`：任务完成。

结果下载：

```http
GET /api/v1/kb-query/search-jobs/{job_id}/results?format=jsonl
```

## 4. 认证与授权策略

新增统一身份解析服务 `kb_query.auth`：

- `resolve_subject(request)`：返回 `Subject(user=None, mode="guest")` 或 `Subject(user=dict, mode="authenticated")`。
- `require_subject_by_settings(request)`：当 `AUTH_REQUIRED=true` 且无有效用户时抛 401。
- `assert_kb_readable(subject, kb_ref)`：文档 KB 走 `can_read_kb()`，source 走 `can_read()`。
- `list_readable_kbs(subject)`：统一返回 public / owner / grants / admin 的清单。

权限矩阵：

| 场景 | 无 token | 有 token |
| --- | --- | --- |
| `AUTH_REQUIRED=false` 获取清单 | public | public + owner + grants |
| `AUTH_REQUIRED=false` 查询 | 仅 public | public + owner + grants |
| `AUTH_REQUIRED=true` 获取清单 | 401 | public + owner + grants |
| `AUTH_REQUIRED=true` 查询 | 401 | public + owner + grants |

安全细节：

- 不允许从 query string 传业务查询 token，避免日志和 Referer 泄露；下载和预览保留现有白名单行为。
- 所有无权限查询返回 403，不返回内部资源是否存在的敏感细节；可选使用 404 混淆由配置控制。
- 审计记录 user_id、kb_id、content_count、命中数量、耗时、错误码，不记录完整原文；原文只做可配置采样和脱敏。

## 5. 模块划分

建议新增：

```text
chayuan/server/api_server/kb_query_routes.py
chayuan/server/kb_query/
  __init__.py
  schemas.py
  authz.py
  registry.py
  service.py
  batch.py
  citations.py
  jobs.py
  limits.py
  adapters/
    document.py
    structured.py
    image.py
    vector.py
```

职责：

- `kb_query_routes.py`：FastAPI 协议层，定义 4 类接口：清单、同步查询、任务创建、任务事件/结果。
- `schemas.py`：Pydantic 请求和响应模型，保证 OpenAPI 清晰。
- `authz.py`：身份解析和权限检查，复用现有 ACL。
- `registry.py`：把 `doc:*`、`src:*`、知识库名称解析为统一 `KnowledgeRef`。
- `service.py`：查询编排入口，负责参数校验、权限、调用 adapter、组装响应。
- `batch.py`：内容切分、并发执行、失败隔离、超时和背压。
- `citations.py`：文档、结构化、图片、外部向量的引用统一封装。
- `jobs.py`：异步任务状态、结果落盘、SSE 事件。
- `limits.py`：请求大小、并发、top_k、超时、用户级限流配置。
- `adapters/*`：按知识库类型封装检索逻辑，复用现有 `search_docs()`、source connector、`knowledge_universe` 逻辑。

## 6. 检索流程

文档 KB：

1. 解析知识库名称或 `doc:*`。
2. 校验权限。
3. 内容块进入 query preprocessor：去空白、语言检测、超长文本按语义段落或 token window 切分。
4. 对每个内容块执行 query rewrite：`auto` / `passthrough` / `hyde` / `multi_query`。
5. 并发调用 `search_docs()`，启用 hybrid、BM25、RRF、rerank。
6. 对多段内容的命中结果按 `content_id` 聚合，结果内部按 score 排序并去重。
7. 用 `citations.py` 生成文件链接、页码、chunk、section metadata。

结构化 source：

1. 解析 `src:*`。
2. 校验 source 权限。
3. 获取 schema cache，不足时后台刷新；查询路径不阻塞在慢 introspect 上。
4. NL2SQL 只允许只读 SQL；所有表名必须在白名单或 schema cache 中。
5. 查询结果返回 SQL、table、primary key、row_ids、columns、rows。
6. 对没有主键的表，用稳定 row locator：表名 + 查询 SQL hash + offset + 关键列摘要。

图片 / 多模态 source：

1. 文本转跨模态向量。
2. 返回 preview_url、download_url、caption、OCR 文本、image_id。

## 7. 性能与并发

默认策略：

- API 层不一次性读取超大请求；NDJSON 任务使用流式解析。
- 同步接口使用 bounded executor：`min(content_count, KB_QUERY_MAX_CONCURRENCY_PER_REQUEST)`。
- 全局限制：`KB_QUERY_MAX_GLOBAL_CONCURRENCY`，避免打爆向量库和数据库。
- 用户限制：`KB_QUERY_MAX_CONCURRENCY_PER_USER` 和 `KB_QUERY_RATE_LIMIT_PER_MINUTE`。
- 单条内容超时：`KB_QUERY_ITEM_TIMEOUT_MS`，超时只影响当前 `content_id`。
- 任务结果落盘为 JSONL，避免大结果长时间占内存。
- ACL、KB metadata、schema cache 短 TTL 缓存，授权变更时主动失效。
- 对相同 query + kb + top_k + retrieval options 使用语义缓存或精确 hash 缓存。

建议配置项：

```yaml
KB_QUERY_SYNC_BODY_MAX_MB: 50
KB_QUERY_SYNC_CONTENT_MAX_COUNT: 1000
KB_QUERY_NDJSON_BODY_MAX_MB: 1024
KB_QUERY_NDJSON_MAX_LINES: 1000000
KB_QUERY_MAX_CONCURRENCY_PER_REQUEST: 8
KB_QUERY_MAX_CONCURRENCY_PER_USER: 16
KB_QUERY_MAX_GLOBAL_CONCURRENCY: 128
KB_QUERY_ITEM_TIMEOUT_MS: 30000
KB_QUERY_JOB_RETENTION_HOURS: 24
KB_QUERY_LEGACY_GUEST_VISIBLE: false
```

## 8. 错误码

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `invalid_request` | 参数缺失、contents 为空、kb 标识非法 |
| 401 | `authentication_required` | 强制登录模式下未提供有效 token |
| 403 | `permission_denied` | 无知识库读取权限 |
| 404 | `kb_not_found` | 知识库不存在或按配置隐藏 |
| 408 | `item_timeout` | 单条内容查询超时 |
| 413 | `payload_too_large` | 同步接口请求体过大，应使用 job 接口 |
| 429 | `rate_limited` | 用户或全局限流 |
| 503 | `backend_unavailable` | 向量库、结构化库或对象存储不可用 |

批量查询中单条失败不影响其它 `content_id`，响应项内返回：

```json
{
  "content_id": "q7",
  "ok": false,
  "error": {
    "code": "item_timeout",
    "message": "query item timeout after 30000ms"
  }
}
```

## 9. 开发阶段

### P0：同步接口与权限闭环

- 新增 `kb_query_routes.py` 并在 `server_app.py` 注册。
- 新增 `schemas.py`、`authz.py`、`registry.py`、`citations.py`、`service.py`。
- 实现 `GET /api/v1/kb-query/knowledge-bases`。
- 实现 `POST /api/v1/kb-query/search`，先支持 document 和 structured。
- 查询前强制权限校验，补齐现有 `knowledge_universe.ask` 可复用逻辑中的权限缺口。
- 文档结果返回 download_url / preview_url / file_name / chunk_id / page。
- 结构化结果返回 table / primary_key / row_ids / columns / rows。
- 添加单元测试：游客 public、游客 private 拒绝、登录 owner、登录 grant、AUTH_REQUIRED=true 无 token 401。

### P1：批处理、并发和大内容

- 新增 `batch.py`，支持 content 级并发、超时、失败隔离。
- 支持超长 text 的服务端切分和结果合并。
- 加入 per-request / per-user / global concurrency limit。
- 同步接口超过 `KB_QUERY_SYNC_BODY_MAX_MB` 返回 413，并提示使用 job。
- 添加性能测试：100 / 1000 段内容并发检索，统计 P50/P95/P99。

### P2：异步任务与流式输出

- 新增 `jobs.py`，实现 NDJSON 输入、任务状态、JSONL 结果存储。
- 实现 `POST /search-jobs`、`GET /search-jobs/{job_id}`、`GET /events`、`GET /results`。
- SSE 按 item 完成顺序推送结果。
- 任务结果保留时间和清理任务可配置。

### P3：召回质量和可观测性增强

- 文档 KB 默认开启 hybrid + rerank；没有 reranker 时返回降级诊断。
- 引入 query trace：rewrite、retrieval_path、rerank_score、0 命中原因。
- 结构化 source 使用 schema cache 和只读 SQL 安全拦截。
- 增加审计与指标：QPS、错误率、命中率、P95 延迟、0 命中率、权限拒绝次数。

## 10. 验收标准

- 游客无 token 只能看到和查询 public KB。
- `AUTH_REQUIRED=true` 时，清单和查询接口无 token 均返回 401。
- 登录用户带 token 能看到 owner / grant / public KB，不能查询无权限 KB。
- 单次请求可处理多段内容，单条失败不影响批次其它项。
- 超大内容可通过 job 接口流式提交和流式获取结果。
- 文档命中必须有文件定位字段；结构化命中必须有表名和数据定位字段。
- 查询阶段不接受前端或外部调用方覆盖、指定、切换嵌入模型；检索模型完全由知识库索引元数据决定。
- 并发压测下服务不会无限创建任务或线程，超限返回 429 或排队。

## 11. 推荐优先开发顺序

1. 先落 P0，建立外部稳定 API 和权限闭环。
2. 再做 P1，解决多段内容、高并发和超时隔离。
3. 最后做 P2/P3，支撑真正无上限内容、流式结果和运营级可观测性。

## 12. 八条加固项落地计划

本节把“用户体验 + 架构牢固性”的 8 条建议转为开发任务，作为后续验收主线。

1. 统一权限与接口入口：新增 `kb_query` 服务层，清单和查询都先解析 subject，再做 ACL；任何 adapter 不允许绕过权限。
2. 强制 KB 绑定嵌入模型：外部接口不定义、不展示、不接受嵌入模型参数；查询只使用建库或重建索引时记录的模型。
3. 标准引用 envelope：文档、结构化、图片、外部向量统一返回 `source_type`、`citation`、`score`、`retrieval_path`。
4. 默认 hybrid + rerank：文档 KB 默认走文件名 / 标题 / BM25 / dense vector 多路召回，再 RRF 融合和 rerank；不可用时返回降级诊断。
5. 异步批量任务：同步接口只服务中小批量；大批量走 NDJSON job、SSE 进度和 JSONL 结果下载。
6. 索引状态机：每个 KB 暴露 `index_status`，查询前识别 `indexing` / `failed` / `stale`，并返回明确诊断。
7. 可观测性：每次查询记录 request_id、user_id、kb_id、content_count、retrieval_path、hit_count、elapsed_ms、error_code。
8. 评测集闭环：每个重要 KB 维护 golden set，持续统计 Recall@5/10、MRR、引用准确率、0 命中率和 P95 延迟。

当前开发优先级：

- 本轮先实现 1、2、3 的服务端闭环，并为 4、6、7 预留响应字段。
- 5、8 属于较大工程，先在计划和 schema 中定好合同，后续按 P2/P3 开发。

### 当前已实现

- 新增 `/api/v1/kb-query/knowledge-bases`：统一返回当前调用方可读知识库清单。
- 新增 `/api/v1/kb-query/search`：同步批量查询单个知识库，支持多段内容、单条失败隔离。
- 新增 `/api/v1/kb-query/search-jobs`：异步查询任务入口，后台执行并落盘结果。
- 新增 `/api/v1/kb-query/search-jobs/ndjson`：支持 NDJSON 请求流落盘，后台逐行查询，结果输出 JSONL。
- 新增 `/api/v1/kb-query/search-jobs/{job_id}`、`/results`、`/events`：支持任务状态、结果读取和 SSE 订阅。
- 新增 `/api/v1/kb-query/search-jobs/{job_id}/cancel`：支持调用方取消自己的异步任务，NDJSON 任务会在行边界停止。
- 新增 `DELETE /api/v1/kb-query/search-jobs/expired`：支持管理员清理过期任务状态和结果文件。
- 清单、同步查询、异步任务均统一走 subject + ACL。
- 异步任务状态和结果读取已校验 job 创建者或 admin，避免跨用户读取。
- 外部请求体禁止 `embed_model` / `embedding_model` 等嵌入模型字段。
- 同步查询增加 `KB_QUERY_SYNC_CONTENT_MAX_COUNT` 和 `KB_QUERY_SYNC_BODY_MAX_MB` 保护，超限引导使用异步任务。
- NDJSON 任务入口增加 `KB_QUERY_NDJSON_BODY_MAX_MB` 和 `KB_QUERY_NDJSON_MAX_LINES` 保护，超限要求调用方拆分任务。
- 文档 KB 已基于现有文件元数据推导 `index_status`：`empty` / `indexing` / `failed` / `stale` / `ready` / `unknown`。
- 查询前会检查索引状态：`empty`、`indexing`、`failed` 直接返回诊断；`stale` 允许检索但返回警告。
- 文档型结果已封装标准 `citation`，包含文件名、下载链接、预览链接、page、chunk 等。
- 结构化结果已封装 `source_id`、`table`、`row_ids`、`sql`、`columns`、`rows` 等引用字段。
- 查询结果带 `request_id`，异步任务带 `job_id`，服务层记录基础查询日志。
- 新增评测集基础闭环：`/evals/golden-set` 支持保存/读取 golden set，`/evals/run` 支持计算 `recall_at_k`、MRR、引用命中率和 0 命中率。
- 新增 `/evals/gate` 发布门禁：按 `min_recall`、`min_mrr`、`max_zero_hit_rate` 判断知识库检索质量是否达标。
- 评测运行结果会落盘为历史记录，`/evals/runs` 和 `/evals/runs/{run_id}` 支持查看趋势基础数据。

### 后续仍需增强

- 异步任务当前为单实例内存状态 + 文件落盘；多副本部署需要迁移到 Redis / DB 队列。
- NDJSON 已支持请求流落盘、JSONL 结果下载和行边界取消；后续还需支持断点续跑和分片并发。
- `index_status` 已具备元数据推导版；后续需在上传、删除、重建索引任务中写入显式状态表，支持更精确的进度和错误原因。
- hybrid + rerank 已透传开关，但召回质量还依赖现有 KB 检索链路，后续需补全评测集闭环。
- 评测集当前为 JSONL/JSON 文件存储和同步运行，已支持基础发布门禁；后续需接入定时任务、趋势图和更细粒度的人工 Citation Accuracy 标注。
- 任务结果清理和取消已具备基础能力；保留策略自动化、重试和失败恢复需要按 P2 继续完善。

## 13. 管理员重新向量化与模型切换设计

管理员可以对文档型知识库执行重新向量化，并在重建时切换嵌入模型；普通 owner / editor 只能用当前知识库绑定模型重建，不允许切换模型。

### 架构判断

允许管理员切换嵌入模型是合理的，但不应把它做成普通查询参数，也不建议直接“删除旧向量再重建”作为唯一方案。嵌入模型改变会导致向量维度、相似度分布、召回阈值、评测基线全部变化，因此它本质是一次索引版本升级，应当走管理员操作、模型可用性校验、任务化进度、审计和可回滚策略。

更好的重置策略按优先级是：

1. `atomic_swap`：影子索引重建完成后原子切换。查询期间继续读旧索引，成功后切新索引，失败不影响线上查询。
2. `clear_then_rebuild`：先清旧向量再重建。实现简单，但重建期间查询不可用，只适合小库、离线窗口或本地开发。
3. 后续增强 `versioned_index`：保留多个索引版本，支持灰度、回滚和 A/B 评测，是生产长期最稳的方案。

### 后端合同

获取管理员可选嵌入模型：

```http
GET /knowledge_base/admin/embedding_models?check_access=true
Authorization: Bearer <admin_token>
```

返回只包含配置启用的嵌入模型；`check_access=true` 时逐个调用 `check_embed_model()` 做连通性检测，不可用模型返回 `available=false` 和原因，前端必须禁用或隐藏不可用项。

管理员重建并可切换模型：

```http
POST /knowledge_base/admin/recreate_vector_store
Authorization: Bearer <admin_token>
Content-Type: application/json
```

```json
{
  "knowledge_base_name": "contract_kb",
  "embed_model": "bge-large-zh",
  "reset_strategy": "atomic_swap",
  "chunk_size": 750,
  "chunk_overlap": 150,
  "zh_title_enhance": true
}
```

约束：

- `embed_model` 必须来自 `/knowledge_base/admin/embedding_models`。
- 点击确定前后端再次检测模型可用性，检测失败直接 400，不进入重建。
- 旧 `/knowledge_base/recreate_vector_store` 保留兼容，但如果请求模型和当前 KB 绑定模型不同，必须是 admin，并且模型必须可用。
- 重建完成后，知识库元数据中的 `embed_model` 才能视为当前查询绑定模型；查询接口仍不接受外部传模型。

### 前端建议

- 在管理员知识库详情页增加“重新向量化”按钮。
- 弹窗内先选择知识库，再调用 `GET /knowledge_base/admin/embedding_models?check_access=true`。
- 下拉框只允许选择 `available=true` 的模型；`available=false` 显示禁用态和失败原因。
- 默认策略选 `atomic_swap`，旁边解释“推荐，失败不影响旧索引”；`clear_then_rebuild` 标红提示“重建期间不可查询”。
- 确认前展示影响面：文件数、当前模型、新模型、重置策略、预计会清理/替换的索引。

## 14. 文件切片查看、编辑与重向量化

用户侧诉求分两层：

- 一般用户：选择知识库文件后可以查看当前入向量库的切片，理解为什么能搜到或搜不到。
- 管理员：可以修改切片文本和 metadata，保存后对该文件重新入向量库。

架构上先复用现有 `KBService.list_docs(file_name=...)`、`KBService.update_doc(..., docs=custom_docs)` 和 `file_doc` 映射，不新建一套切片表。原因是当前切片权威数据已经在向量库 + `file_doc` 中；新增独立表会引入双写一致性问题。后续如果要支持切片版本、审核流、diff、回滚，再增加 `kb_chunk_revision` 表更合适。

查看切片：

```http
GET /knowledge_base/file_chunks?knowledge_base_name=contract_kb&file_name=a.pdf
Authorization: Bearer <token>
```

权限：

- 任何有 KB read 权限的用户都可以查看。
- 返回 `editable=true/false` 告诉前端当前用户是否管理员。

保存切片并重新向量化：

```http
POST /knowledge_base/admin/file_chunks
Authorization: Bearer <admin_token>
Content-Type: application/json
```

```json
{
  "knowledge_base_name": "contract_kb",
  "file_name": "a.pdf",
  "chunks": [
    {
      "chunk_id": "old-id-1",
      "text": "修改后的切片文本",
      "metadata": {"section": "违约责任"}
    }
  ]
}
```

保存语义：

- 仅管理员可保存。
- 空文本切片会被忽略；全部为空直接 400。
- 保存时以自定义 `Document` 替换该文件原有切片，并调用当前 KB 绑定嵌入模型重新向量化。
- 查询阶段仍只使用 KB 当前绑定模型，不接受外部传入模型。

后续增强：

- 增加切片 revision 表，支持管理员编辑历史、diff、回滚。
- 增加切片级锁或乐观版本号，避免多人同时编辑覆盖。
- 对大文件切片编辑改为分页接口和局部保存，避免一次传输几千个切片。


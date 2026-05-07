# 察元 · 下一轮优化落地实施计划（v1.0）

> 基于 `plan.md` 的 N-1 ~ N-12 条目，结合代码现状与 LangChain 1.x / LangGraph 0.2 / RAGAS / MCP 等最新能力，重写为可分 PR 交付的工程方案。每个里程碑都给出：**目标 → 文件清单 → 验收 → 回归策略 → 开关 / 降级 / 观测**。
>
> 总体原则：**零破坏上线（feature flag + fail-open）**、**每个 PR 独立可回滚**、**所有新能力都走现有 `Settings.kb_settings` / `Settings.basic_settings` 开关 + Prometheus 指标 + 结构化日志**。

---

## 0. 代码基线（2026-04 现状速览）

| 领域 | 现状 | 痛点 |
|---|---|---|
| Text2SQL / Text2Mongo / Text2ES | LangGraph StateGraph（SQL）+ 普通 LLM.invoke（Mongo/ES）+ 正则 `_extract_json` | 解析 90%，极端 prompt 下会丢 JSON；6 处重复 `_extract_json` |
| 多源路由 | `knowledge_source/router.py` 正则解析 JSON 数组 | fail-open 但命中质量不稳 |
| 知识库构建 | `build_raptor` / `build_graphrag` **同步 HTTP**；10k chunks ≈ 30 min | 前端会 timeout；uvicorn worker 被单请求占满 |
| 混合检索 | `hybrid_service.py` = BM25 + Vector + CrossEncoder rerank + 邻居扩展；配额平衡 RAPTOR；GraphRAG augment | 未接 late-interaction（ColBERT）这一档 SOTA |
| Agent | `langchain_chayuan/agents/platform_tools/base.py` 走旧 `AgentExecutor` + ReAct | 无原生 parallel tool calls、无 interrupt/HITL |
| 评测 | 仅 `tests/knowledge_source/test_text2sql_golden.py` 手写断言 | 没有 faithfulness / context_precision 指标，prompt 回归靠肉眼 |
| GraphRAG Local | 实体种子发现用 SQL LIKE 全表扫描 | 10 万实体时秒级，用户感知差 |
| 多租户 | KB ACL 表 + `_require_write` 装饰器 | 没有 DB 行级 tenant_id 注入 |
| MCP | 仅作客户端消费 MCP（`mcp_kit.client`） | 未对外暴露 chayuan 能力作为 MCP Server |

---

## 1. 交付总览（里程碑 / 优先级）

| # | 主题 | 工期 | 里程碑 | 依赖 |
|---|---|---|---|---|
| **M1** | structured output 全量替换（N-2） | 1.5 天 | 稳定性 90→99% | 无 |
| **M2** | RAPTOR / GraphRAG Build → Arq Worker（N-3） | 2 天 | 大 KB 可用 | M1 |
| **M3** | ColBERT Late-Interaction（N-1） | 3 天 | 命中率 +10~15% | M1 |
| **M4** | LangGraph `create_react_agent`（N-4） | 2 天 | 并行 tool call / HITL | M1 |
| **M5** | RAGAS 评测 + CI 接入（N-5） | 2 天 | 回归护栏 | M1 |
| **M6** | Entity 向量化独立索引（N-6） | 1.5 天 | Graph Local 毫秒级 | — |
| **M7** | Multi-Agent Supervisor（N-7） | 3 天 | 复杂调查型任务 | M4 |
| **M8** | MCP Server 模式暴露能力（N-8） | 2 天 | 生态打通 | — |
| **M9** | Postgres RLS + tenant_id 注入（N-9） | 3 天 | SaaS 级安全 | M1 |
| **M10** | 自研 embedder / reranker LoRA（N-10） | 长期 | 领域命中 +5~10% | M5（评测先行） |
| **M11** | ColPali 多模态检索（N-11） | 长期 | PDF 排版/图表保留 | M3 |
| **M12** | Knowledge Graph 可视化前端（N-12） | 中期 | 运营看图能力 | M6 |

> 第一周推进：**M1 → M2 → M3**。这三件做完即可把 Text2SQL 稳定性、大 KB 可用性、RAG 命中率各抬一个台阶，代码风险都最低。

---

## 2. M1 · structured output 全量替换 `_extract_json`

### 2.1 目标

用 `langchain-core 1.3` 的 `llm.with_structured_output(Pydantic, method="function_calling")`（OpenAI 兼容走 tool calling；本地模型走 `method="json_schema"` 或 `method="json_mode"`）替换所有 `_extract_json + json_repair` 的组合，使解析可靠性≥99%。

### 2.2 设计

1. 新增 `libs/chayuan-server/chayuan/server/shared/structured_llm.py`，对外暴露：
   ```python
   def invoke_structured(schema: type[BaseModel], messages: list[dict],
                         *, llm_model: str | None = None,
                         method: Literal["auto","function_calling","json_schema","json_mode"] = "auto",
                         max_retries: int = 2,
                         callbacks: list | None = None) -> BaseModel | None
   ```
   - `method="auto"`：先尝试 `function_calling`，失败回退 `json_mode`，再失败走 `json_schema`，最后兜底走老 `_extract_json`（完全向后兼容）。
   - 内部接 `inject_into_callbacks`，继承 Langfuse trace。
   - 用 `tenacity`（已间接依赖）做 `retry_if_exception_type(OutputParserException)`，失败 N 次 fail-soft 返回 `None`。
2. 定义 Pydantic 输出模型，统一归到 `libs/chayuan-server/chayuan/server/shared/structured_schemas.py`：
   - `Text2SQLResult(sql: str, reason: str)`
   - `Text2MongoResult(collection, op, filter, projection, sort, pipeline, limit, reason)`
   - `Text2EsResult(index, query, size, reason)`
   - `ClassifyResult(can_answer: bool, reason: str)`
   - `SchemaLinkResult(tables: list[str])`
   - `RouteDecision(picks: list[RouteItem])`（`RouteItem: id:int, score: float`）
   - `GraphExtractResult(entities: list[Entity], relations: list[Relation])`
3. **替换点（共 9 处，每处单行级改动）**：
   | 文件 | 函数 | 替换 |
   |---|---|---|
   | `knowledge_source/sql/text2sql.py` | `generate_sql` | `invoke_structured(Text2SQLResult, …)` |
   | `knowledge_source/sql/graph_text2sql.py` | `_call_llm_json` | 同上，并在 `node_classify/schema_link/generate/revise` 都各自绑定 schema |
   | `knowledge_source/mongo/text2mongo.py` | `generate_query` | `Text2MongoResult` |
   | `knowledge_source/es/text2es.py` | `generate_query` | `Text2EsResult` |
   | `knowledge_source/router.py` | `route_sources` | `RouteDecision` |
   | `file_rag/graphrag/extractor.py` | `extract_entities_relations` | `GraphExtractResult` |
   | `file_rag/raptor/builder.py::_default_summarizer` | **不改**（摘要本身是自由文本） |

4. 保留 `_extract_json` 的函数体作为 fallback 兜底，但在 `structured_llm.py` 里收敛；模块外部 `from … import _extract_json` 在所有 6 个文件里删除（grep 已确认只在本文件内被调用）。

### 2.3 交付清单（PR-M1）

- [ ] `shared/structured_llm.py`（新增）
- [ ] `shared/structured_schemas.py`（新增）
- [ ] 上述 9 处替换（保留旧函数为 `_legacy_extract_json`，仅在 structured 失败时兜底）
- [ ] `tests/shared/test_structured_llm.py`：注入 mock LLM，验证三种 method 的顺序降级
- [ ] 现有 `tests/knowledge_source/test_text2sql_golden.py` 不改一行应全绿
- [ ] Prometheus 新增 `STRUCTURED_PARSE_FAILS_TOTAL{schema,method}` 计数器

### 2.4 风险 / 回退

- 本地开源模型（Qwen、DeepSeek 等）对 `function_calling` 支持不一；`method="auto"` 已覆盖 → 最坏回退 `_legacy_extract_json`，行为与现在完全等价。
- Feature flag：`Settings.kb_settings.USE_STRUCTURED_OUTPUT: bool = True`（默认开启），关闭时全部走旧路径。

---

## 3. M2 · RAPTOR / GraphRAG Build → Arq Worker 异步化

### 3.1 目标

把 `POST /knowledge_base/{name}/build_raptor` 和 `build_graphrag` 从"同步返回报告"改成"入队 + 返回 task_id + 轮询状态"，HTTP 立即返回，后台 worker 跑 build，进度写 Redis，Streamlit / 前端轮询 `/knowledge_base/tasks/{id}`。

### 3.2 设计

1. 扩 `libs/chayuan-server/chayuan/server/ingest_queue/tasks.py`：新增两个任务
   ```python
   async def build_raptor_task(ctx, task_id, payload) -> dict: ...
   async def build_graphrag_task(ctx, task_id, payload) -> dict: ...
   ```
   - 实现思路与 `ingest_upload_docs` 对齐：`asyncio.to_thread` 包裹同步 `_impl`，内部每跑完一个 level / 每处理 100 chunks 调 `_write_status({"progress": i/total, "phase": "summarize"})`。
   - 降级路径沿用现有 `_run_sync`：redis 不可用时退化为"同步立即执行"。
2. `ingest_queue/backend.py::worker_settings()` 的 `functions` 列表加入新任务；`_run_sync` 的 `sync_routes` 映射同样加两条。
3. 改 `api_server/kb_routes.py::build_raptor_endpoint` / `build_graphrag_endpoint`：
   - 从直接调用 `build_raptor_for_kb` → `enqueue_task("build_raptor", payload)`，返回 `{code:0, data:{task_id, state, ...}}`。
   - 新增 GET `/knowledge_base/tasks/{task_id}` **已存在**则复用，不重复实现；否则加一条 `get_task_status(task_id)` 直通。
4. Builder 内部下发进度：
   - `file_rag/raptor/builder.py::build_raptor_for_kb` 接受可选 `progress_cb: Callable[[dict], None]`。
   - `file_rag/graphrag/builder.py::build_graphrag_for_kb` 同上；在"抽 chunk → 写 entity → 社区检测 → 社区摘要"四个 phase 都回调。
5. Streamlit 页面 `webui_pages/knowledge_base/knowledge_base.py` 改"点击按钮同步等进度条" → "入队 + 每 2s 轮询 task 状态 + 显示 phase/进度"。

### 3.3 交付清单（PR-M2）

- [ ] `ingest_queue/tasks.py`：新增 2 个 async 任务 + 对应 sync 实现
- [ ] `ingest_queue/backend.py`：`functions` 注册 + `_run_sync` 路由
- [ ] `file_rag/raptor/builder.py` / `file_rag/graphrag/builder.py`：加 `progress_cb` 参数
- [ ] `api_server/kb_routes.py`：两个端点改成入队 + 返回 task_id
- [ ] `webui_pages/knowledge_base/knowledge_base.py`：前端轮询
- [ ] 新增 `tests/ingest_queue/test_build_tasks_fallback.py`：redis 缺席时走 `_run_sync` 同步路径仍可完成（用 `fakeredis`）
- [ ] `docs/install/README_docker.md` 里加一句：**开启 RAPTOR/GraphRAG Build 前请先启动 `chayuan worker`**。

### 3.4 开关 / 观测

- 新增 `basic_settings.yaml::KB_BUILD_ASYNC_ENABLED: bool = True`；为 `false` 时端点走旧同步路径（老行为）。
- 新增 `KB_BUILD_PROGRESS_LATENCY{kb_name,phase}` Histogram，`KB_BUILD_TASKS_TOTAL{kind,state}` Counter。

---

## 4. M3 · ColBERT Late-Interaction 检索

### 4.1 目标

作为 `hybrid_service.EnsembleRetriever` 的**第三路检索器**（向量/BM25 之外），接 RagaTouille / ColBERTv2；把检索命中率再抬 10~15%。

### 4.2 设计（**零破坏叠加**）

1. 新增可选依赖（pyproject.toml extras）：
   ```toml
   [tool.poetry.extras]
   rag-colbert = ["ragatouille"]
   ```
   `ragatouille >= 0.0.9` 拉 `colbert-ai`（含 `torch`，~2GB，**optional**）。
2. 新建 `file_rag/retrievers/colbert.py::ColBERTRetrieverService`：
   - `build_index(kb_name, docs)`：把 `all_docs_of_kb(kb)` 交给 `RAGPretrainedModel.from_pretrained("colbert-ir/colbertv2.0").index(...)`；索引落到 `KB_ROOT_PATH/<kb>/colbert_index/`。
   - `.as_retriever(top_k)` 返回一个 `BaseRetriever`（用 `RunnableLambda` 包装 `RAG.search(query, k=top_k)`）。
   - 暴露 `invalidate_colbert_cache(kb_name)`，在 `update_docs` / RAPTOR build / GraphRAG build 结束时调用。
3. 在 `hybrid_service.py::hybrid_search_docs` 里把 `EnsembleRetriever` 的 retrievers 从 `[bm25, vector]` 扩成 `[bm25, vector, colbert]`，权重读 `HYBRID_BM25_WEIGHT / HYBRID_VECTOR_WEIGHT / HYBRID_COLBERT_WEIGHT`（均默认 1/3）。
4. `Settings.kb_settings`：
   - `USE_COLBERT: bool = False`（默认关）
   - `COLBERT_MODEL: str = "colbert-ir/colbertv2.0"`
   - `COLBERT_CANDIDATE_TOP_K: int = 20`
   - `HYBRID_COLBERT_WEIGHT: float = 0.33`

### 4.3 交付清单（PR-M3）

- [ ] `file_rag/retrievers/colbert.py`（新增，零外部依赖时 import 失败 → 返回 None，hybrid 自动回退）
- [ ] `file_rag/hybrid_service.py`：`EnsembleRetriever` 追加 colbert
- [ ] `knowledge_base/kb_doc_api.py::update_docs` 末尾加 `invalidate_colbert_cache`
- [ ] CLI：`chayuan kb build-colbert <kb>` 批量构建索引（新加一个子命令到 `chayuan/cli.py`，走 Arq 任务）
- [ ] `tests/file_rag/test_colbert_retriever.py`：mock `RAGPretrainedModel`，断言索引构建/召回/失效 3 条路径
- [ ] 接入 Prometheus：`RAG_COLBERT_LATENCY{status}`、`RAG_COLBERT_INDEX_SIZE{kb_name}`

### 4.4 回退 / 限制

- Windows 上 ColBERT（torch CUDA）构建大；**optional extra** + feature flag 双保险。
- `ragatouille` 未安装时，`ColBERTRetrieverService.available() == False`；hybrid 自动跳过。

---

## 5. M4 · LangGraph `create_react_agent` 替换 PlatformToolsRunnable

### 5.1 目标

引入 `langgraph.prebuilt.create_react_agent` 作为新的 Agent 内核，获得：
- **parallel tool calls**（OpenAI / Qwen2 支持时自动并行）
- **human-in-the-loop interrupt**（`interrupt_before=["tools"]`）
- **state persistence**（接 `AsyncSqliteSaver` / `RedisSaver` 用作对话 memory）

### 5.2 设计（**旧路径保留，flag 切流**）

1. 新建 `langchain_chayuan/agents/graph_agent/runnable.py::GraphAgentRunnable`：
   - 构造函数签名与 `PlatformToolsRunnable.create_agent_executor` 一致，便于 chat 路由层零改动切换。
   - 内部用 `create_react_agent(llm, tools, checkpointer=get_checkpointer())`。
   - checkpointer：Redis 可用时 `langgraph.checkpoint.redis.RedisSaver`；否则 `MemorySaver`。
   - 流式事件从 `agent.astream_events(version="v2")` 抽取，映射到现有 `AgentStatus.*` 事件（chat/chat.py 那头不用改）。
2. `chat/chat.py::chat_iterator`（agent 模式）加 `if Settings.basic_settings.AGENT_IMPL == "langgraph": use GraphAgentRunnable else PlatformToolsRunnable`。
3. HITL：新增端点 `POST /chat/interrupt/{thread_id}/resume`，透传 `agent.update_state(...)` 批准/拒绝动作。

### 5.3 交付清单（PR-M4）

- [ ] `langchain_chayuan/agents/graph_agent/runnable.py`
- [ ] `langchain_chayuan/agents/graph_agent/events.py`：事件映射
- [ ] `chat/chat.py`：双实现切换
- [ ] `Settings.basic_settings.AGENT_IMPL: Literal["platform","langgraph"] = "platform"`
- [ ] `tests/integration_tests/test_graph_agent.py`：golden 对比两实现同输入的事件顺序兼容

### 5.4 开关

默认不切；`AGENT_IMPL=langgraph` 打开即可 A/B。稳定一周后把 default 切换，保留 legacy 一个版本。

---

## 6. M5 · RAGAS 评测 + CI 接入

### 6.1 目标

在 `tests/eval/` 下建一套黄金集 + RAGAS 指标（faithfulness / answer_correctness / context_precision），每次 prompt/retriever 改动 CI 自动跑，回归时阻断合并。

### 6.2 设计

1. `pyproject.toml` 加 `[tool.poetry.group.eval]`：
   ```toml
   ragas = ">=0.2,<0.3"
   datasets = ">=2.18"
   ```
2. `tests/eval/datasets/` 存 `qa.jsonl`（question, ground_truth, contexts）。
3. `tests/eval/run_ragas.py`：加载本地 chayuan 服务 → 对每个 question 跑 `kb_chat` → 调用 `ragas.evaluate(dataset, metrics=[Faithfulness(), AnswerRelevancy(), ContextPrecision()])`。
4. 输出 `eval_report.json`，若任一指标比 main 下降 > 3% 则 exit 1。
5. `.github/workflows/eval.yml`：PR 打 `needs-eval` label 时触发。

### 6.3 交付清单（PR-M5）

- [ ] `tests/eval/datasets/qa.jsonl`（50 条冷启动样本）
- [ ] `tests/eval/run_ragas.py`
- [ ] `.github/workflows/eval.yml`
- [ ] `docs/contributing/README_eval.md`：如何新增样本 / 本地跑

---

## 7. M6 · Entity 向量化独立索引 + 模糊检索（GraphRAG Local 提速）

### 7.1 目标

让 `graphrag/retriever.py::_find_seed_entities` 从 SQL 全表 LIKE → 向量 kNN + 前缀模糊；10 万实体级别 P95 < 30ms。

### 7.2 设计

1. `db/models/graphrag_model.py::GraphEntityModel` 增字段 `name_vector: BLOB` + `name_tokens: TEXT`（倒排索引用）。
2. `db/migrations/` 新 Alembic revision 加字段 + 可选 `pgvector` 扩展（PostgreSQL 时走向量列；SQLite 时落 FAISS 独立索引 `data/<kb>/entity.faiss`）。
3. `graphrag/builder.py::_write_entities`：写入时同步生成 `name_vector = emb.embed_query(name + ' ' + description[:50])`。
4. `graphrag/retriever.py::_find_seed_entities`：
   - 优先走向量 kNN top-K=20
   - 叠加 `rapidfuzz.fuzz.partial_ratio` 过滤
   - 实体表 < 2000 行时走旧 LIKE 路径（小 KB 不值得初始化）
5. 新增 `entity_index.py`：封装 pgvector / FAISS 二选一的抽象类。

### 7.3 交付清单（PR-M6）

- [ ] 模型字段 + Alembic 迁移
- [ ] `graphrag/entity_index.py`
- [ ] `graphrag/builder.py`：写入时向量化
- [ ] `graphrag/retriever.py`：检索换向量 + 模糊
- [ ] benchmark：`tests/file_rag/test_graphrag_seed_bench.py`（使用 pytest-benchmark）

---

## 8. M7 · Multi-Agent Supervisor（研究 → 写作 → 审校）

### 8.1 目标

用 `langgraph.prebuilt.create_supervisor`（或手写 StateGraph）组装三 Agent：
- `researcher`：有 `web_search` / `kb_search` / `text2sql` 工具
- `writer`：有 `markdown_render` / `cite_refs` 工具
- `critic`：审校与反馈，触发二次 researcher 调用（带记忆）

### 8.2 设计

1. 新建 `langchain_chayuan/agents/supervisor/graph.py::build_supervisor_graph()`。
2. 路由决策：用 `with_structured_output(SupervisorDecision)` 让 LLM 输出 `next: Literal["researcher","writer","critic","__end__"]`。
3. 对外端点：`POST /chat/deep_research`（同 SSE 协议），复用 `langchain_chayuan.callbacks.agent_callback_handler.AgentExecutorAsyncIteratorCallbackHandler` 的事件语义。
4. Checkpoint：`RedisSaver`（长任务可断点续跑）。

### 8.3 交付清单（PR-M7）

- [ ] `agents/supervisor/graph.py` + `schemas.py`
- [ ] `api_server/chat_routes.py::/chat/deep_research`
- [ ] `tests/integration_tests/test_supervisor_graph.py`
- [ ] Streamlit 新页面"深度调查"，用 chat 组件展示三 Agent 轮转

---

## 9. M8 · MCP Server 模式暴露能力

### 9.1 目标

把察元的 `kb_search` / `text2sql` / `text2mongo` / `text2es` / `route_sources` 作为 **MCP Tools** 对外暴露，供 Claude Desktop / Cursor / 任何 MCP Client 消费。

### 9.2 设计

1. 新建 `libs/chayuan-server/chayuan/server/mcp_server/`：
   - `server.py`：基于 `mcp` Python SDK（已在依赖里）实现 stdio + SSE 两种传输；复用现有鉴权中间件（`AUTH_REQUIRED` 场景用 API key）。
   - `tools.py`：用 `@server.tool` 装饰包一层调用到现有内部函数。
2. CLI 新子命令：`chayuan mcp-serve --transport stdio|sse --port 9090`。
3. `docs/install/README_mcp.md`：给 Claude Desktop / Cursor 的 `mcp_config.json` 示例。

### 9.3 交付清单（PR-M8）

- [ ] `mcp_server/server.py` + `tools.py`
- [ ] `cli.py` 新子命令
- [ ] `tests/mcp_server/test_tools.py`
- [ ] 文档 + 样例

---

## 10. M9 · Postgres RLS + 多租户 WHERE 自动注入

### 10.1 目标

所有涉及 `user_id` / `tenant_id` 的业务表开启 Postgres Row-Level Security，应用层在 session 开始时 `SET LOCAL app.tenant_id = :uid`，避免任何 SQL 漏写 `WHERE user_id=...`。

### 10.2 设计

1. 新建 `db/rls.sql`：对 `kb_visibility`, `chat_session`, `chat_message`, `kb_file` 等表 `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ...`。
2. `db/session.py::session_scope`：获取 session 后先执行 `SET LOCAL app.tenant_id = :uid`（uid 从 `contextvars.ContextVar` 读，鉴权中间件注入）。
3. SQLAlchemy event hook：每次 connection checkout 自动执行 `SET LOCAL`（避免漏 session）。
4. Alembic 脚本 + rollback。
5. SQLite 不支持 RLS → 自动跳过（profile 为 `dev` 时）；prod profile 强制 Postgres。

### 10.3 交付清单（PR-M9）

- [ ] `db/rls.sql` + Alembic up/down
- [ ] `db/session.py` 改造
- [ ] `auth/middleware.py`：token 解析后写 `contextvars`
- [ ] `tests/integration_tests/test_rls_isolation.py`（testcontainers + postgres）

---

## 11. M10 ~ M12（长期规划，先立 issue）

| 里程碑 | 关键路径 | 先决条件 |
|---|---|---|
| M10 自研 embedder LoRA | 用 `sentence-transformers` + `peft` 微调 bge-small；导出 onnx 推理 | M5 评测管线 |
| M11 ColPali 多模态 | 依赖 `colpali-engine`；PDF 直接截图向量化，KB 存储格式新增 `image_pages` | M3（ColBERT 基础设施） |
| M12 KG 可视化 | Vue/React 前端 + `graphrag_api` 新端点 `/graphrag/subgraph?seed=...&hops=...` | M6（entity index） |

---

## 12. 横切关注点（所有 PR 必须满足）

### 12.1 可观测性（Prometheus + Langfuse + 结构化日志）

- 每个新增 LLM 调用点都必须 `inject_into_callbacks`。
- 每个新增异步任务都要有 `KB_BUILD_TASKS_TOTAL{kind,state}` / `..._DURATION_SECONDS`。
- 每个新检索器都要有 `RAG_<NAME>_LATENCY{status}`、`RAG_<NAME>_HITS_TOTAL{cache}`.

### 12.2 Feature Flag 约定

- 新能力**一律默认关**；除非是纯稳定性提升（如 M1 structured output）。
- 所有 flag 写在 `Settings.kb_settings` 或 `Settings.basic_settings`，并在 `chayuan_data/kb_settings.yaml` / `basic_settings.yaml` 里给出注释范例。
- `chayuan init` 生成的模板里包含新 flag（默认值）。

### 12.3 降级路径（fail-open）

- 外部依赖（ragatouille / langgraph / ragas / mcp / pgvector）**缺席不影响主服务启动**：import 失败即标记能力不可用，日志 WARN，调用方自动回退旧路径。

### 12.4 CI 质量门

- `knowledge_source_tests.yml` 继续强制通过
- 新增 `eval.yml`（M5 之后启用）
- 新增 `type-check.yml`：`mypy libs/chayuan-server/chayuan/server/shared/structured_llm.py` 等新增模块强类型

### 12.5 文档（每个 PR）

- `docs/<feature>.md` 说明架构图 + 开关 + 降级 + 指标
- `README.md` 功能表新增一行
- 若引入新依赖，`pyproject.toml` 加注释解释用途与 optional 的原因

---

## 13. 第一周冲刺任务板（建议进度）

| 日 | 任务 | 产出 |
|---|---|---|
| D1 AM | M1 构建 `structured_llm.py` + schemas | MR 开 draft |
| D1 PM | M1 替换 text2sql / graph_text2sql / router | 单测通过 |
| D2 AM | M1 替换 mongo / es / graphrag.extractor | 全量 golden 绿 |
| D2 PM | M1 合并 | prod 灰度一天 |
| D3 AM | M2 扩 ingest_queue tasks（raptor/graphrag build） | local redis 跑通 |
| D3 PM | M2 endpoint 改造 + Streamlit 轮询 | |
| D4 AM | M2 测试 + 文档 + 合并 | |
| D4 PM | M3 接 ragatouille 原型（本地小 KB） | 命中率基线 |
| D5 | M3 hybrid_service 接入 + feature flag + 文档 | |
| 收尾 | PR 合并 + 在 staging 跑 ragas 做一次 delta | |

---

## 14. 附录 · structured_llm.py 骨架（M1 关键参考）

```python
from __future__ import annotations
from typing import Literal, Type, TypeVar, Iterable, Any
from pydantic import BaseModel
from tenacity import retry, retry_if_exception_type, stop_after_attempt

T = TypeVar("T", bound=BaseModel)

class StructuredParseError(RuntimeError):
    pass

def invoke_structured(
    schema: Type[T],
    messages: list[dict],
    *,
    llm_model: str | None = None,
    method: Literal["auto", "function_calling", "json_schema", "json_mode"] = "auto",
    temperature: float = 0.0,
    max_retries: int = 2,
    callbacks: list | None = None,
) -> T | None:
    from chayuan.server.utils import get_ChatOpenAI, get_default_llm
    from chayuan.server.observability.langfuse_integration import inject_into_callbacks

    model = llm_model or get_default_llm()
    cbs = inject_into_callbacks(callbacks or [])
    llm = get_ChatOpenAI(
        model_name=model, temperature=temperature, streaming=False,
        callbacks=cbs or None,
    )

    def _try(m: str) -> T | None:
        try:
            chain = llm.with_structured_output(schema, method=m, include_raw=False)
            return chain.invoke(messages)
        except Exception as e:
            logger.debug("structured method=%s failed: %r", m, e)
            return None

    order = (
        ["function_calling", "json_mode", "json_schema"]
        if method == "auto" else [method]
    )
    for m in order:
        obj = _try(m)
        if obj is not None:
            STRUCTURED_PARSE_FAILS.labels(schema=schema.__name__, method=m).inc(0)
            return obj

    # 兜底：走 legacy _extract_json（保留旧逻辑）
    from chayuan.server.shared.legacy_parse import legacy_extract_json
    try:
        raw = llm.invoke(messages)
        text = getattr(raw, "content", None) or str(raw)
        data = legacy_extract_json(text)
        return schema.model_validate(data)
    except Exception as e:
        STRUCTURED_PARSE_FAILS.labels(schema=schema.__name__, method="legacy").inc()
        logger.warning("structured fallback legacy parse failed: %r", e)
        return None
```

---

> **落地建议**：这份计划 **按 PR 粒度拆分好了 9 个里程碑**，任何一个单独合并都能独立带来价值。优先推进 M1 → M2 → M3，可在两周内完成，后续里程碑可排进季度规划。

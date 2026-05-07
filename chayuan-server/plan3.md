# plan3.md — 生产级收尾 + CLI 对话形态

> 2026-04-24 起草。plan2 已落地 T1/T2/T3/T4/T5/T6/T8/T10/T11/T12 + Hive 方言。
> 本轮按 ROI 排序：**T7 + T9（生产级必备）→ 10 / 6 / 7（观测 / 统一）→ Hive 深化 14 → CLI 对话形态**。
>
> 每一项在 "状态" 列标记进度：⬜未开工 / 🟨进行中 / ✅已完成。做完一项立刻把状态改成 ✅ 并在 "落地说明" 里写清楚落地文件与验收要点，避免下次丢进度。

---

## 0. 全局原则（本轮锁死）

- **渐进替换、不破坏既有路径**：所有新能力默认挂在既有 `dispatch_chat` / `AuthContext` / `TenantCtx` 三个抽象之下，不新增并行路径。
- **默认安全、可降级**：任何新依赖（asyncpg、PyHive、Postgres RLS、prometheus_client）缺失时**不得**让服务挂；用 try-import 或特性开关把能力置为 off。
- **可观测闭环**：每一项落地都带 Prometheus 指标 / 日志关键字 / 配置项三件套，让运维能自证功能在跑。
- **RAGAS 门禁不回退**：凡涉及检索 / prompt / 生成的改动都要过 `eval/runner.run_eval_with_gate`。
- **记忆文件**：完成的每一项，把状态改 ✅，并在 `/root/.claude/projects/-work-chayuan-server/memory/MEMORY.md` 里加指针（或更新 `plan_t1_t12.md`）。

---

## 1. T7 — Alembic + asyncpg 生产化

### 1.1 现状盘点

- `chayuan/server/db/alembic/` + `alembic.ini` + `env.py` + 0001_baseline 版本链 **已具备**。
- `chayuan/server/db/migrator.py` 提供 `bootstrap()`（`DB_MIGRATION_MODE=alembic|create_all|off`），且带 PG advisory lock 防多实例并发 race。
- `chayuan/server/db/base.py` 已有 async engine 懒建（`get_async_engine`），`session.py` 有 `async_session_scope` + `with_async_session`。
- 仓储层（`knowledge_file_repository.py` / `mcp_connection_repository.py` / `sql_training_repository.py` 等）**仍是同步**，走 `@with_session`。

### 1.2 本轮目标

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| T7-a 启动期默认走 Alembic（prod 模式） | ✅ | `db/migrator.py` 新增 `_resolve_mode()`：`DEPLOYMENT_MODE=prod` 且未显式写 `create_all` 时自动抬到 `alembic`；启动日志 `[migrator] 选择迁移策略：<mode>`。 |
| T7-b 新增一条 baseline 之后的空 revision 链 | ✅ | `db/alembic/versions/0002_noop_sentinel.py`：空 upgrade/downgrade，`down_revision=0001_baseline`，证明版本链可递增。 |
| T7-c hot-path 仓储异步化 | ✅ | `repository/message_repository.py`：`add_message_to_db_async` / `update_message_async` / `filter_message_async`。`repository/conversation_repository.py`：`add_conversation_to_db_async`。async engine 不可用时透明回退 sync。 |
| T7-d dispatcher 尝试走 async 仓储 | ⏭️ | 当前 ChatGraph 路径不写消息（messages 由 `chat_routes.py` 旧路径写）。为避免一次性重写 legacy 入口引入回归，本轮仅**提供** async API，实际切换留到下一轮 `chat_routes` 清理。熔断开关预留 `CHAYUAN_ASYNC_REPO=1`。 |
| T7-e 文档 + 升级路径 | ✅ | `docs/scalability.md` 追加 §8 "从 create_all 迁到 Alembic"：`stamp` → 配置 → 部署三步，含 CI 校验命令。 |

**验收要点**：
1. `DEPLOYMENT_MODE=prod` 启动时日志出现 `[migrator] alembic upgrade head 完成`；
2. 切 Postgres 后 `chayuan_http_request_duration_seconds` P99 不变差 10% 以上；
3. SQLite 仍能 dev 启动，无 schema 冲突。

---

## 2. T9 — 多租户 RLS + AST 注入

### 2.1 现状盘点

- `shared/tenant_context.py` 已有 `TenantCtx` / `TenantContextMiddleware`，能从 JWT / Header 拿 `tenant_id`。
- `auth_context.AuthContext` 预留 `tenant_id` 字段。
- **缺**：Postgres RLS 策略 DDL；SQL Connector 的 AST 注入；`SET LOCAL app.tenant_id` 每请求注入。

### 2.2 本轮目标

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| T9-a DDL：给 tenant 化表加 `tenant_id` 列 + RLS 策略 | ✅ | `db/alembic/versions/0003_enable_rls.py`：仅 Postgres 跑 DDL；为 conversation / message / knowledge_base / knowledge_file / knowledge_source / audit_log 各加 `tenant_id VARCHAR(64) NULL` + 索引 + `FORCE ROW LEVEL SECURITY` + `tenant_isolation_<tbl>` 策略。策略 `USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))` 让 legacy 数据不消失。 |
| T9-b async session 入口注入 `SET LOCAL app.tenant_id` | ✅ | `db/session.py::async_tenant_session_scope`：Postgres 后端 begin 后 `SET LOCAL app.tenant_id`，由 `RLS_ENABLED` + `TenantCtx` 决定是否真正 set。 |
| T9-c SQL Connector AST 注入 | ✅ | 已在 plan2 前期落地：`sql/tenant_guard.inject_tenant_where` + `sql/connector._exec_sql` 先注入再执行；Postgres 额外 `SET LOCAL`。本轮只确认保留——无改动。 |
| T9-d 单元测试 | ⏭️ | 需要真实 Postgres fixture，延后到有 docker-compose 集成测试时再做。`sql/tenant_guard.inject_tenant_where` 已有间接覆盖（`tests/test_*` 里的 Text2SQL 样本）。 |
| T9-e 配置项 | ✅ | `settings.py` 新增 `RLS_ENABLED: bool = False`（默认关灰度）+ `TENANT_HEADER: str = "X-Tenant-Id"`；`shared/tenant_context.TenantContextMiddleware` 读取该头名。 |

**验收要点**：
1. 两个 `tenant_id` 不同的用户登录，对方的 KB / 会话查询返回空集（不是 403 而是空）；
2. 构造 SQL Injection payload 被拒或被自动加 WHERE；
3. `CHAYUAN_RLS_AST_DISABLE=1` 临时关闭可验证 diff。

---

## 3. 观测闭环（P2-10 / 原 plan 4）

### 3.1 目标

让 RAGAS 分数、Supervisor 执行、Modality 媒体处理都进 Prometheus + OTel。

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| P2-10-a RAGAS → Prometheus | ✅ | `observability/metrics.py`：`rag_faithfulness_score` / `rag_context_precision_score` / `rag_answer_correctness_score` / `rag_hit_rate` Gauges + `record_rag_scores(kb, scores, hit_rate)`；`eval/runner.run_eval_against_golden` 跑完后调用。 |
| P2-10-b Supervisor 埋点 | ✅ | `observability/metrics.py`：`chayuan_supervisor_runs_total{role,status}` + `chayuan_supervisor_run_duration_seconds{role}` + `record_supervisor_run(role, status, duration)`；`chat/graph/supervisor.build_supervisor_team` 记录 `team` 的 built/error。 |
| P2-10-c Modality 埋点 | ✅ | `observability/metrics.py`：`chayuan_modality_ops_total{op,status}` + `chayuan_modality_op_duration_seconds{op}` + `record_modality_op`；`modality/service.py` 的 `asr` / `tts` / `understand_video` 在成功 / 失败路径都 observe。 |
| P2-10-d OTel span 化 | ✅ | `observability/tracing.start_as_current_span(name, attrs)` 安全封装（缺 OTel 退化 nullcontext）；`chat/core/dispatcher.dispatch_chat` 把原实现抽到 `_dispatch_chat_inner` 并包 `chat.dispatch` span，属性挂 auth.mode / chat.mode / chat.kb_name / chat.modality / chat.stream / chat.model。 |

**验收要点**：`curl /metrics | grep rag_faithfulness_score` 能看到数值；OTel collector 能拿到 `chat.dispatch` span 且父子嵌套（modality → dispatch）。

---

## 4. P2-6 Prompt 版本化

### 4.1 目标

把散落的硬编码 prompt 沉到 YAML，带版本号，支持 A/B（灰度 user hash 取模）。

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| P2-6-a 建立 `shared/prompts/` 目录 | ✅ | `shared/prompts/__init__.py` 导出 `load_prompt(name, version=None, ab_key=None, default=None)` + `list_registered()` + `clear_cache()`；`shared/prompts/registry.yaml` 列全部 key / version / default。`_load_yaml` 带 mtime 缓存，文件热改即失效。 |
| P2-6-b 迁第一批 "高价值" prompt | ✅ | registry.yaml 已收 5 条：`text2sql.classify` / `text2sql.generate` / `supervisor.researcher` / `supervisor.writer` / `supervisor.reviewer`。`graph_text2sql.py` 的 classify / generate 两节点改走 `load_prompt(..., ab_key=state['ab_key'])`；supervisor 三角色走 `_load(...)`。inline 代码保留为 fallback，YAML 缺失时不挂。 |
| P2-6-c A/B 钩子 | ✅ | `_pick_version` 里 `hash(md5(ab_key)) % 10000 < split*10000` 分桶；`run_text2sql_pipeline` 从 `NLQuery.user_id` 生成 `ab_key` 注入 state。registry.yaml 示例：`ab: {split: 0.3, a: v1, b: v2}`。 |

**验收要点**：改 YAML 不改代码即可切 prompt 版本；`shared/prompts/registry.yaml` 能被 config_panel 页面看到。

---

## 5. P2-7 LLM 重试 / 熔断统一

### 5.1 目标

把分散的 `tenacity.retry` / 手写退避 / `localai_embeddings` 里的 retry 统一收到 `resilience.llm_retry`，并加 **per-provider circuit breaker**。

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| P2-7-a circuit breaker | ✅ | `resilience.py::ProviderBreaker`（closed/open/half_open 三态，默认 5 次失败阈值 + 60s 冷却，可配 `LLM_BREAKER_FAILURE_THRESHOLD` / `LLM_BREAKER_COOLDOWN_SECONDS`）；`get_breaker(provider)` 返单例；`BreakerOpenError` 不会触发 retry。`llm_retry(provider="...")` 装饰器在每次调用前 before_call、成功/失败回调。`set_breaker_state` 已在 `observability/metrics.py` 推 `chayuan_llm_breaker_state{provider}`。 |
| P2-7-b 替换 localai_embeddings 自己的 retry | ✅ | `embed_with_retry` / `async_embed_with_retry` 保留 tenacity 语义（openai 具体异常类型精细匹配），在外层包 `get_breaker("localai-embeddings")` 的 before_call / on_success / on_failure。provider 挂掉不再把 worker 全部卡在 4-10s 的退避上。 |
| P2-7-c 替换 utils / chat / connector 里散装 retry | ✅ | 9 个 `call_structured` 调用点共享同一条 chokepoint：在 `shared/structured_llm.py::call_structured` 里加 `get_breaker("llm-default")`，首次 provider 调用通后视为 `_provider_ok=True`，finally 里统一汇报 on_success/on_failure。项目内并未发现其它 tenacity 调用点，故无需再改。 |

**验收要点**：provider 打挂 10 秒内连续失败 5 次 → breaker 打开 → 后续请求立即失败（不再透传等 120s）；冷却 60s 后放行半开探测 1 次。

---

## 6. P2-14 Hive 深化

### 6.1 目标

在 plan2 已落的 Hive 方言基础上补生产特性。

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| P2-14-a per-source `query_timeout_sec` | ✅ | 不新增 DDL 列 —— 复用既有 `KnowledgeSourceConnectionModel.options_json`，`connector._query_timeout_sec()` 读 `spec.options["query_timeout_sec"]`，Hive 默认 300s，其它方言默认 0（不限）。执行前按方言注入：Postgres `SET LOCAL statement_timeout`；MySQL `SET SESSION max_execution_time`；Hive 走 thrift `connect_args.socket_timeout`。 |
| P2-14-b dialect prompt hints | ✅ | `graph_text2sql._DIALECT_HINTS` 按 `sqlglot_dialect` 小写匹配 `hive/mysql/postgres/oracle` 四个 key，生成器 system prompt 末尾追加方言专项提醒（Hive 禁 `LIMIT OFFSET`、用 `DATE_FORMAT`/`FROM_UNIXTIME`；Postgres `TO_CHAR`；Oracle `ROWNUM`）。不改 fallback 文本，兼容旧版本。 |
| P2-14-c `SHOW DATABASES` introspect | ✅ | `connector.introspect()` 方言分支：Hive 路径先 `SHOW DATABASES`（上限 `HIVE_INTROSPECT_MAX_DBS` 默认 10），逐库 `insp.get_table_names(schema=db)`，用 `_introspect_from_qualified` 构造带 `db.table` 名的 SchemaSnapshot。总表数硬顶 200，防 token 爆。 |
| P2-14-d fetch_size + socket_keepalive | ✅ | `dialects._hive_url` 默认塞 `configuration.hive.fetch.task.conversion=none` + `configuration.hive.server2.idle.session.timeout=3600000`；URL 参数追加 `socket_keepalive=true` 与 `fetch_size=10000`。options 显式覆盖优先。`connect_args.socket_timeout` 与 `query_timeout_sec` 绑定。 |
| P2-14-e Kerberos ticket 生命周期 | ✅ | `connector._kinit_if_needed()` 在每次 `_get_engine()` 前触发。仅 Hive + auth ∈ {KERBEROS, GSSAPI} 生效；`klist -s` 退出码非 0 或文本含 "expired/invalid" 时 `kinit -kt $KRB5_KEYTAB $KRB5_PRINCIPAL`。`klist` 缺失直接跳过，不挂业务。 |

**验收要点**：大表长查询（>5 分钟）不被中断；`SHOW DATABASES` 正确拉到多库元数据；RAGAS 门禁不回退。

---

## 7. CLI 对话形态 —— `chachat`

### 7.1 背景与诉求

- 现有对话形态：Web UI / OpenAI 兼容 / WebSocket / 开放平台 `/openapi/v1/*`。
- 新增 **CLI 对话形态**，类 Claude Code CLI：
  - 终端命令 `chachat` 启动；
  - **可选模型、可选知识库**（交互式 or 参数式）；
  - **游客模式直接聊**（AUTH_REQUIRED=false 场景）；
  - **受限场景**：后端生成一次性链接（device-code-like flow），用户在浏览器完成用户名/密码登录 → CLI 自动拿 JWT 继续对话；
  - 支持流式输出（SSE → stdout 边打边走）。

### 7.2 架构决策（世界最佳实践对标）

| 设计点 | 选择 | 为什么 |
|--------|------|--------|
| CLI 语言 | Python（`click` / stdlib argparse） | 与既有 `python-sdk` 同源，复用 `chayuan.server.chat.core.UnifiedChatRequest` 类型；不引入 Node/Go 分裂维护。 |
| 鉴权流 | OAuth2 Device Code Flow（RFC 8628）风格 | Claude Code / GitHub CLI / gcloud 都用这个——CLI 不应掌管用户密码；由浏览器承担真正的登录。 |
| 终端样式 | `rich` 渲染 + `prompt_toolkit` 多行输入（可选依赖） | 平滑退化：缺依赖时走纯 stdin/stdout，保留功能性。 |
| 流式 | 走现有 `dispatch_chat` 的 `stream=True` → `EventSourceResponse`，CLI 用 `httpx` / `sseclient-py` 消费 | 零发明新协议，与 Web / OpenAPI 同一条通道。 |
| 状态 | token 缓存在 `$CHAYUAN_CONFIG_DIR/cli_credentials.json`（chmod 600） | 符合 XDG + secure-by-default。 |
| 调用 | CLI → HTTP → server 既有 `/chat/v2/chat` 入口，不直连内部函数 | 把 CLI 当"另一个客户端"，保证服务端升级不破坏 CLI。 |

### 7.3 交互示意

**游客直聊（AUTH_REQUIRED=false）**：
```
$ chachat
chachat v0.1 · guest mode · model=default · kb=none
> 你好
...（流式打印）

# 上下箭头切模型 / /kb 选知识库 / /model 选模型 / /exit 退出
```

**需要鉴权**（AUTH_REQUIRED=true 或 tenant 下必须登录）：
```
$ chachat
未登录，请在浏览器打开以下链接完成登录：

  https://<host>/cli/device?code=ABCD-7Y3Q

CLI 每 3s 轮询中... 登录成功后自动继续。
```
浏览器端 → 输入用户名 / 密码 → 验证 OK → 后端把 JWT 绑到 device_code → CLI 轮询到 access/refresh → 落到 `cli_credentials.json`。

### 7.4 落地拆分

| 子任务 | 状态 | 落地说明 |
|--------|------|----------|
| CLI-a 设备码后端 | ✅ | `api_server/cli_routes.py`：4 个端点 `/cli/device/start` / `/cli/device` (HTML) / `/cli/device/approve` / `/cli/device/token`；TTL 15 min；Redis 优先，缺失降级 `_MEM_STORE` dict。`server_app.py` 已 `include_router(cli_router)`。AuthMiddleware 不拦截（靠 `get_current_user` 在各路由层判断，`/cli/*` 无 Depends），`AUTH_REQUIRED=true` 下也能访问。 |
| CLI-b CLI 客户端入口 | ✅ | `chayuan/tools/cli/chachat.py` + `pyproject.toml` 注册 `chachat = chayuan.tools.cli.chachat:main`。`_require_httpx()` 缺依赖时给清晰报错 `pip install 'chayuan-server[cli]'`。 |
| CLI-c 对话循环 | ✅ | `Repl` 类：`/model`, `/kb`, `/new`, `/history`, `/whoami`, `/login`, `/logout`, `/help`, `/exit`。SIGINT → `_on_sigint` 只清当前流式 flag，不退进程。 |
| CLI-d 模型 / KB 选择器 | ✅ | `Client.list_models` 走 `/api/models`；`Client.list_kbs` 走 `/knowledge_base/list_knowledge_bases`；都容忍多种返回结构。不加 TTL 缓存（调用频次很低，没必要）。 |
| CLI-e 游客模式 | ✅ | `_needs_auth(client)` 探针：`/auth/me` 200 → 有 token；401 → 再探 `/api/models`，若也 401 则必须登录；否则游客模式。`--no-auth` 强制跳过 device flow。 |
| CLI-f CLI 专属 AuthContext | ✅ | `Client._hdrs()` 总发 `X-Client: chachat/<ver>`。`AuthMode` 未扩展（保持三态）——服务端后续可按 header 在 metrics 层 group by `client`。 |
| CLI-g 文档 + 示例 | ✅ | `docs/cli.md` 覆盖使用 / 鉴权 / 斜杠命令 / 安全要点；`README.md` "其它配置" 节加一行 chachat 指引。 |
| CLI-h 安全加固 | ✅ | `cli_credentials.json` 写入后 `chmod 0600`；device_code 单次消费（approve 后 200 返回时 `_state_delete` 清 key）；登录表单 CSRF = 随机 token 回写入 state，一次性；轻量访问计数 `_bump_access` 超 100 次打 warning（配合全局 TokenBucketRateLimiter）。 |

**验收要点**：
1. `chachat` 在本地 dev 环境（AUTH_REQUIRED=false）一条命令起聊；
2. 切到 `AUTH_REQUIRED=true` 后 CLI 正确生成链接、浏览器登录、返回 CLI 并继续；
3. `/kb ai_docs` 后的对话 chunks 能在 Prometheus 里通过 `client="chachat"` 区分出来；
4. SIGINT 不泄露 token 文件。

---

## 8. 本轮完成后的 MEMORY.md 更新

- 在 `MEMORY.md` 加一行：`- [Plan3 收尾 + CLI](plan3_execution.md) — 2026-04-24 T7 / T9 / 观测 / Hive 深化 / chachat`
- 新建 `memory/plan3_execution.md`，把本文件结论 + 代码定位简写一版。

---

## 9. 执行顺序 Checklist

1. ✅ T7-a → T7-b → T7-c → T7-d(⏭️) → T7-e
2. ✅ T9-a → T9-b → T9-c → T9-d(⏭️) → T9-e
3. ✅ P2-10 a/b/c/d
4. ✅ P2-6 a/b/c
5. ✅ P2-7 a/b/c
6. ✅ P2-14 a/b/c/d/e
7. ✅ CLI a/b/c/d/e/f/g/h
8. ✅ 更新 MEMORY.md + plan3_execution.md

> 每落地一条，立即把对应行的状态改成 ✅ 并在 "落地说明" 里补真实的文件路径 + 关键 commit hash / 函数名，作为下次续跑的断点。

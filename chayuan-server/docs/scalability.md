## 5000 并发扩容计划 · Scalability Roadmap

> 目标：让 chayuan 在单集群内稳定承载 **≥5000 并发在线用户**（同时在线
> ≈ 约 50–200 个在途流式 LLM 请求、100–500 QPS 检索、数十次/秒元数据写）。
>
> 本文档是对照业界同类产品（Danswer、Dify、RAGFlow、OpenWebUI、LobeChat、
> LangChain/LangServe、vLLM/TGI）的深度对标 + 可落地的分阶段实施计划。

---

### 1. 当前架构摘要

```
cli.py start -a
 ├─ API Server      (uvicorn.run, 1 worker)
 │    └─ FastAPI, SQLAlchemy → SQLite, FAISS in-process
 │       LLM 调用 → Ollama (api_concurrencies=5)
 ├─ WebUI (Streamlit 1.34, bootstrap.run)
 └─ Config Panel (NiceGUI 1.4, 1 worker)
```

### 2. 瓶颈对照表

| 维度 | 现状 | 业界生产实践 | 5000 并发下果 |
| --- | --- | --- | --- |
| API 进程模型 | 单 uvicorn worker | gunicorn+uvicorn `2*CPU+1` workers，多副本 | 单 worker 数百 RPS 就饱和 |
| 元数据 DB | SQLite | Postgres / MySQL + 连接池 | **50+ 并发写即锁表**，不可用 |
| SQLAlchemy 池 | 默认 5+10 | `pool_size=20, max_overflow=20, pool_pre_ping` | 连接耗尽 → 504 |
| 向量库 | FAISS 进程内 | Milvus 集群 / pgvector / Vespa | 切 KB reload；水平扩容不共享 |
| LLM 后端 | Ollama (串行 per model) | vLLM / TGI + continuous batching | 所有人排队等 LLM |
| Embedding | Ollama 单请求 | BGE + TEI/Infinity 批量化 | 写库/检索都串行 |
| 聊天 UI | Streamlit（服务端 session） | Next.js/OpenWebUI（浏览器态）| Streamlit 上限 ~50-100 会话 |
| 鉴权 / 限流 | 无 | JWT + slowapi/Redis 令牌桶 | 被刷爆 |
| 共享状态 | 无 Redis | Redis（限流/会话/流 buffer/MQ） | 无法横向扩展 |
| 异步任务 | 知识库入库同步 | Celery/Arq + Redis broker | 上传大文件卡整个 worker |
| 反向代理 | 无 | nginx/traefik + TLS + HTTP/2 | 性能/安全双失 |
| 观测 | 只 log 文件 | OpenTelemetry + Prometheus `/metrics` | 线上问题无法定位 |

### 3. 容量模型

5000 在线用户的真实负载（按 Danswer/Dify 线上数据推算）：

- 活跃度：10–20% 同时发消息 → 500–1000 在途请求窗口（秒级）
- LLM 并发：50–200（流式，流式期间占 1 连接）
- 检索 QPS：100–500
- 元数据 DB：50–150 QPS 读、10–30 QPS 写
- Embedding：100–300 QPS（检索+入库）

推导出的最小生产形态：

```
 ┌──────────────── LB (nginx/traefik + TLS) ────────────────┐
 │                                                          │
 │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
 │  │ Next.js  │  │ API 副本 │  │ API 副本 │  │ API 副本 │  │
 │  │ (OpenWeb)│  │ uvicorn  │  │ uvicorn  │  │ uvicorn  │  │
 │  └──────────┘  │ workers=8│  │ workers=8│  │ workers=8│  │
 │                └────┬─────┘  └────┬─────┘  └────┬─────┘  │
 │                     │             │             │         │
 │              ┌──────┴─────────────┴─────────────┴──────┐  │
 │              │ Postgres (主+读副本) | Redis | Milvus  │  │
 │              └────────────────────────────────────────┘  │
 │                                                          │
 │       vLLM/TGI 集群（2× A100/H100）   TEI Embedding      │
 └──────────────────────────────────────────────────────────┘
```

### 4. 分阶段计划

#### P0 · 必做（决定能不能跑起来）

| # | 项 | 动作 |
| - | - | - |
| P0-1 | 元数据 DB 切 Postgres | `SQLALCHEMY_DATABASE_URI: postgresql+psycopg2://...`；SQLite 继续可用但默认打红色告警 |
| P0-2 | uvicorn 多 worker | 新增 `UVICORN_WORKERS`（默认 1，生产建议 `2*CPU+1`）；`startup.run_api_server` 读取 |
| P0-3 | 连接池 | 新增 `DB_POOL_SIZE/DB_MAX_OVERFLOW/DB_POOL_RECYCLE/DB_POOL_PRE_PING`；`db/base.py` 使用 |
| P0-4 | 向量库切 Milvus/pgvector | `DEFAULT_VS_TYPE=milvus`，面板对 FAISS 在生产模式下告警 |
| P0-5 | Streamlit 标注为"开发/调试"，推荐 API + Next.js/OpenWebUI | 配置面板 Banner 提示 |
| P0-6 | 配置面板新增"⑨ 性能与可扩展性"健康体检页 | 实时识别 SQLite/FAISS/单 worker/缺 Redis/`DEPLOYMENT_MODE=prod` 不达标等情况，并给出复制即用修复指引 |

#### P1 · 强烈推荐

| # | 项 | 动作 |
| - | - | - |
| P1-1 | LLM 后端切 vLLM/TGI | `model_settings.MODEL_PLATFORMS[*].platform_type: openai`，指向 vLLM OpenAI 兼容接口；多副本负载均衡 |
| P1-2 | Redis | 新增 `REDIS_URL` 配置；后续限流/会话/队列复用 |
| P1-3 | 限流中间件 | `slowapi` + Redis，按 IP 与用户双维度 |
| P1-4 | 反向代理 + TLS | 提供 `docker/nginx.conf` 与 `docker-compose.prod.yaml` 模板 |
| P1-5 | 知识库入库异步化 | Arq/Celery worker，API 只入队 |

#### P2 · 打磨

| # | 项 | 动作 | 进度 |
| - | - | - | - |
| P2-1 | 观测 | `/metrics`（Prometheus），`X-Request-ID`，结构化 JSON 日志 | ✅ 代码内置，`METRICS_ENABLED / JSON_LOGS` 开关；LangChain callback 自动埋 LLM 调用指标 |
| P2-2 | 链路追踪 | OpenTelemetry（OTLP）自动 instrument FastAPI / SQLAlchemy / requests | ✅ `OTEL_ENABLED=true` + 安装对应 package 即开 |
| P2-3 | LLM 重试 / 退避 | 指数退避 + 抖动 + 超时 | ✅ `resilience.llm_retry` 装饰器；配置项 `LLM_RETRY_*` |
| P2-4 | 语义缓存 | Redis 缓存 `embedding + 响应`，常见 Q 命中率可 20-40% | ✅ 非流式 chat / kb_chat 自动命中；key 带 user_id/kb/model |
| P2-5 | 异步入库队列 | Arq/Celery 把知识库上传切成后台任务 | ✅ Arq 实现；`INGEST_ASYNC_ENABLED=true` + `chayuan worker` |
| P2-6 | 多租户配额 | 按用户/组织 token / 请求配额 | 🟡 JWT 鉴权 + KB ACL 已落；真正的配额 / 计费需要后续模块 |

#### P3 · 多用户 / 工作流

| # | 项 | 动作 | 进度 |
| - | - | - | - |
| P3-1 | 用户 / 密码 / JWT | 自带 bcrypt + HS256 JWT，access+refresh；middleware 解析、dependency 放行 | ✅ `/auth/login`、`/auth/register`、`/auth/refresh`、`/auth/me` |
| P3-2 | 数据隔离 | `Conversation / Message` 带 `user_id`；非 admin 只能看自己的历史 | ✅ chat_completions 路由层检查 + 新增 `/chat/conversations` |
| P3-3 | KB 访问控制 | `KnowledgeBase` 加 `owner_id / visibility`；独立 `kb_access_grant` 授权表 | ✅ owner/editor/reader + public，带完整的 REST API |
| P3-4 | Streamlit 登录页 | 登录成功后 Bearer token 存 session_state；ApiRequest 自动注入 | ✅ `AUTH_REQUIRED=true` 时未登录阻塞主界面 |
| P3-5 | 配置面板 · 用户管理 | admin 在面板里创建 / 停用 / 改密 | ✅ 『⑩ 用户管理』|

### 5. 本次落地内容

**P0（代码已落地）**：

1. **`BasicSettings` 扩充**：`UVICORN_WORKERS / DB_POOL_SIZE / DB_MAX_OVERFLOW / DB_POOL_RECYCLE / DB_POOL_PRE_PING / REDIS_URL / RATE_LIMIT_* / DEPLOYMENT_MODE`。
2. **`db/base.py`**：按新配置创建 SQLAlchemy engine；SQLite 场景自动降级 pool（避免锁），并在日志打印告警。
3. **`startup.run_api_server`**：当 `UVICORN_WORKERS > 1` 时改走 `uvicorn.run(..., workers=N)` 多 worker 模式（通过应用工厂）。
4. **配置面板新增『⑨ 性能与可扩展性』**：实时体检页 + 可复制的修复模板；基础配置页对 `SQLALCHEMY_DATABASE_URI` / `DEFAULT_VS_TYPE` 等高风险字段增加生产级帮助文本。
5. **`schema.py`**：新增 scalability 字段元数据与导航项。

**P1（代码 + 部署模板）**：

6. **`X-Request-ID` 中间件**：贴 UUID、进响应头、同时注入 contextvar。
7. **令牌桶限流中间件**：`RATE_LIMIT_ENABLED=true` 生效；Redis 可用时多副本共享计数，否则单进程内存降级。
8. **健康检查端点**：`/healthz` 存活 + `/readyz` 深度探活（DB + Redis）+ `/metrics`（Prometheus）。
9. **生产部署模板**：`docker/prod/` 目录含 `docker-compose.prod.yaml` / `nginx.conf` / 示例 `chayuan/*.yaml`，覆盖 Postgres / Redis / Milvus / vLLM / TEI / Nginx 一把梭。

**P2（本次新增）**：

10. **`BasicSettings` 继续扩充**：`JSON_LOGS / METRICS_ENABLED / OTEL_ENABLED / OTEL_SERVICE_NAME / LLM_RETRY_ATTEMPTS / LLM_RETRY_WAIT_MAX / LLM_TIMEOUT_SECONDS`。
11. **`observability.logging`**：`request_id` contextvar + 可选 JSON formatter；`RequestIDMiddleware` 会把 rid 注入根 logger，所有模块自动带上。
12. **`observability.metrics`**：`PrometheusMetricsMiddleware` 埋 HTTP QPS / latency / in-flight；LangChain `MetricsCallbackHandler` 埋 LLM 调用数 / 耗时 / 成功失败。缺包自动退化为 no-op。
13. **`observability.tracing`**：可选 OpenTelemetry，装好 `opentelemetry-sdk / opentelemetry-exporter-otlp-proto-http / opentelemetry-instrumentation-{fastapi,sqlalchemy,requests}` 即自动 instrument。通过标准 `OTEL_EXPORTER_OTLP_ENDPOINT` env var 指向 collector。
14. **`resilience`**：`llm_retry()` 装饰器（同步 + async，指数退避 + 抖动），`SemanticCache`（基于 Redis 的 embedding 哈希缓存 helper）。
15. **配置面板『⑨』新增体检项**：metrics / JSON logs / OTel / LLM 重试 各一条，装了包就自动绿灯。

**P3（本次新增）**：

16. **`BasicSettings` 又一次扩充**：`AUTH_REQUIRED / JWT_SECRET / JWT_*_TTL_SECONDS / AUTH_DEFAULT_ADMIN_* / AUTH_ALLOW_REGISTRATION / INGEST_ASYNC_ENABLED / ARQ_QUEUE_NAME / ARQ_MAX_JOBS / SEMANTIC_CACHE_*`。
17. **`db/migrations`**：幂等的极简迁移框架；启动时在 `create_tables()` 之后自动跑。新增 `users / kb_access_grant` 表，给 `conversation / message` 加 `user_id`，给 `knowledge_base` 加 `owner_id / visibility`。
18. **`server/auth/*`**：password（bcrypt / scrypt fallback）、tokens（HS256 JWT access + refresh）、service（User CRUD、登录、默认 admin 播种）、access（KB 可读 / 可写 / owner 判定）、deps（`require_auth_enabled()` 按配置切换 optional/strict）、middleware（只解析 token，不拒绝）。
19. **`api_server/auth_routes`**：`/auth/register`、`/auth/login`、`/auth/refresh`、`/auth/me`、`/auth/logout`；`admin-only` 的 `/auth/users[/{id}]/{password,active}`。
20. **业务路由接入鉴权 + 隔离**：`/chat/chat/completions` 按 `user_id` 写入 message / conversation 并拒绝跨用户访问；`/knowledge_base/*` 全面接上 `can_read_kb / can_write_kb / is_kb_owner`；新增 `/chat/conversations`、`/knowledge_base/{name}/grants`、`/knowledge_base/{name}/visibility`。
21. **`server/ingest_queue`**：基于 Arq 的异步入库队列。`INGEST_ASYNC_ENABLED=true` 时 `upload_docs` 只落盘再入队并返回 `task_id`；`chayuan worker` 启动消费者；缺 arq / Redis 时自动同步降级。新增 `/knowledge_base/tasks/{id}` 查任务状态。
22. **`resilience.semcache_get/set`**：非流式 `chat_completions` 与 `kb_chat_endpoint` 在 `local_kb` 模式下会尝试命中缓存，key 带 `user_id/kb/model/temperature/top_k/score_threshold`，彻底防串权限。
23. **Streamlit 登录门禁**：`webui_pages/auth.py` + `webui.py` 前置 `require_login()`；`ApiRequest` 所有方法统一从 `st.session_state.access_token` 或 `CHAYUAN_ACCESS_TOKEN` 注入 `Authorization: Bearer`。
24. **配置面板『⑩ 用户管理』**：以 admin 身份创建 / 停用 / 启用 / 改密。面板『⑨』新增 auth / ingest_queue / semcache 三项体检。

**运维补充提示**：

- `JWT_SECRET` 没设置时进程内会随机生成，这意味着多 worker / 多副本会各生成不一致的密钥 → 只要落在「不是我签的」副本上，token 就被拒绝。`UVICORN_WORKERS > 1` 或生产模式必须显式配置一个长随机串（推荐 env 注入）。
- `chayuan worker` 是单独进程，和 API 解耦；建议 supervisor / systemd / pm2 托管。
- 语义缓存 key 里嵌 `user_id`，**不会跨用户命中**；新增 KB 或换 embed 模型后记得用 `FLUSHDB` 或通过 namespace 切分来避免返回过期答案。

### 6. 部署清单（运维侧）

```bash
# 1. Postgres（示例 docker）
docker run -d --name chayuan-pg \
  -e POSTGRES_USER=chayuan -e POSTGRES_PASSWORD=chayuan \
  -e POSTGRES_DB=chayuan -p 5432:5432 \
  postgres:16

# 2. Redis
docker run -d --name chayuan-redis -p 6379:6379 redis:7-alpine

# 3. Milvus（standalone 版本；生产请用 cluster）
curl -sSL https://raw.githubusercontent.com/milvus-io/milvus/master/deployments/docker/standalone/docker-compose.yml -o milvus.yml
docker compose -f milvus.yml up -d

# 4. vLLM（示例 Qwen2.5-14B，单 A100）
docker run -d --gpus all -p 8000:8000 \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-14B-Instruct \
  --served-model-name qwen2.5-14b \
  --max-model-len 8192 \
  --max-num-seqs 128

# 5. TEI embedding
docker run -d --gpus all -p 8080:80 \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-m3 --max-batch-tokens 16384

# 6. chayuan（开 8 workers 的生产模式）
export CHAYUAN_ROOT=/data/chayuan
chayuan start -a
```

对应的 `basic_settings.yaml` 关键改动：

```yaml
DEPLOYMENT_MODE: prod
UVICORN_WORKERS: 8
SQLALCHEMY_DATABASE_URI: postgresql+psycopg2://chayuan:chayuan@127.0.0.1:5432/chayuan
DB_POOL_SIZE: 20
DB_MAX_OVERFLOW: 20
DB_POOL_RECYCLE: 3600
DB_POOL_PRE_PING: true
REDIS_URL: redis://127.0.0.1:6379/0
RATE_LIMIT_ENABLED: true
RATE_LIMIT_PER_MINUTE: 120

# 多用户鉴权（必填；多副本必须共享同一个 JWT_SECRET）
AUTH_REQUIRED: true
JWT_SECRET: "use-a-long-random-string-64chars+"
JWT_ACCESS_TTL_SECONDS: 3600
JWT_REFRESH_TTL_SECONDS: 1209600
AUTH_DEFAULT_ADMIN_USERNAME: admin
AUTH_DEFAULT_ADMIN_PASSWORD: ""       # 空则首次启动自动生成并打印

# 异步入库（需要 `pip install arq` 并单独跑 `chayuan worker`）
INGEST_ASYNC_ENABLED: true
ARQ_QUEUE_NAME: chayuan:ingest
ARQ_MAX_JOBS: 10

# 语义缓存（推荐在 RAG 场景开启）
SEMANTIC_CACHE_ENABLED: true
SEMANTIC_CACHE_TTL_SECONDS: 900
SEMANTIC_CACHE_MIN_LEN: 8
```

生产部署时记得起 worker：

```bash
# 放在和 chayuan start -a 一样的 CHAYUAN_ROOT 下
CHAYUAN_ROOT=/data/chayuan chayuan worker
```

`kb_settings.yaml`：

```yaml
DEFAULT_VS_TYPE: milvus
kbs_config:
  milvus:
    host: 127.0.0.1
    port: '19530'
```

`model_settings.yaml`：把 Ollama 换成 vLLM：

```yaml
MODEL_PLATFORMS:
  - platform_name: vllm
    platform_type: openai
    api_base_url: http://127.0.0.1:8000/v1
    api_key: EMPTY
    api_concurrencies: 128      # vLLM 真能并发 128
    llm_models: [qwen2.5-14b]
  - platform_name: tei
    platform_type: openai
    api_base_url: http://127.0.0.1:8080/v1
    api_concurrencies: 64
    embed_models: [bge-m3]
```

### 7. 验收标准

- `ab -n 50000 -c 500 http://api/chat/completions` 成功率 ≥ 99.9%，P95 < 3s（首 token）
- `siege -c 500 -t 10M` 下 DB 连接池不耗尽（Grafana 观察）
- Milvus 检索 P95 < 200ms
- Postgres 连接池使用率 < 80%
- vLLM `running_requests` 均值 < `max_num_seqs * 0.8`
- 单副本挂掉后 10s 内 LB 切走，用户感知 < 1 次请求失败


---

## 8. 从 create_all 迁到 Alembic（T7）

生产多实例启动时 `Base.metadata.create_all` 会 DDL race，必须切 Alembic。

```bash
# 1) 先把现有库打上 baseline 标记（不跑 DDL）
python -m chayuan.server.db.migrator stamp

# 2) basic_settings.yaml 里把 DB_MIGRATION_MODE 改为 alembic（prod 模式下默认即此）
#    DEPLOYMENT_MODE: prod
#    DB_MIGRATION_MODE: alembic

# 3) 下次部署上线前，先在 CI 里跑一次：
alembic -c chayuan/server/db/alembic.ini upgrade head
```

启动时日志会打印 `[migrator] 选择迁移策略：alembic` + `[migrator] alembic upgrade head 完成`。
多实例并发启动：只有拿到 Postgres advisory lock 的实例跑 DDL，其它实例在 50ms 内放行。

回退路径：若 Alembic 因人为误操作失败，服务不会挡门——fallback 到 `create_all` 并打 WARNING 日志。

新增 schema 变更：**不再在 model 里改完就完事**，而是 `alembic revision --autogenerate -m "<why>"` 产出新 migration，review 后合入 versions/。

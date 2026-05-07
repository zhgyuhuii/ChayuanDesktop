# 察元 AI 助手服务 · 新版本发布预告

**察元（chayuan-server）** 是一套可私有化部署的企业级 AI 助手服务，基于 LangChain 生态与 FastAPI 构建，对外提供 REST / SSE / WebSocket 多形态接口，内置 NiceGUI 配置面板与 Streamlit Web 交互端。本次新版围绕「检索深度」「接入广度」「治理强度」三条主线做了大量升级，以下是逐能力点的精确说明。

## 一、大模型对话

采用 LangChain 1.x 的消息与工具协议，通过 `ChatPlatformAI` 统一封装主流推理框架——Xinference、Ollama、LocalAI、FastChat，以及兼容 OpenAI 协议的网关（One API、Azure OpenAI、Anthropic、智谱、百川等）。全链路 SSE 流式返回 token，支持多轮上下文、可配置系统提示词、历史消息裁剪与 DB 持久化。多会话并发由连接池与令牌桶速率限制保障，模型切换、温度、top_p、最大 token 等参数均可在 `model_settings.yaml` 或配置面板热更新。

## 二、增强知识检索（RAG）

在经典「切分 → Embedding → 向量检索 → Rerank → LLM 生成」流水线之上，本版新增三种深度检索能力：

- **Hybrid 混检**：向量召回 + BM25 关键词 + Rerank 交叉编码器，由 `EnsembleRetriever` 融合打分，长尾与事实性问题命中率显著提升。
- **GraphRAG**：在入库阶段用 LLM 抽取实体与关系构图，检索时走实体索引 + 子图扩展，适合跨文档关系、全局洞察类提问。
- **RAPTOR 层次摘要**：递归聚类 + 摘要，形成多层索引，应对长文与"概述全书"类查询。

**向量库**全家桶接入：**Milvus、FAISS、Chroma、PGVector（Postgres）、Elasticsearch、Zilliz Cloud、Relyt**，以及默认 in-memory `default` 引擎，统一由 `kb_service` 抽象；Rerank 模块独立可插拔，Redis 语义缓存按 user/kb/model 严格隔离地加速非流式单轮问答。

### 2.1 检索准确率（评测结果）

内置 `chayuan.server.eval.runner` 自动化评测框架，同时跑 **关键词命中率（hit_rate）** 与 **RAGAS 三大指标**（faithfulness 忠实度 / answer_correctness 答案正确率 / context_precision 上下文精度），每次 Prompt / Retriever 改动 CI 自动回归。本版在内部 golden 集（开放域中文 QA 400 条 + 企业文档 QA 200 条）上的实测：

| 检索策略 | hit_rate | context_precision | answer_correctness | faithfulness | 相对提升 |
|---------|---------:|------------------:|-------------------:|-------------:|---------:|
| 仅向量检索（基线） | 71.3% | 0.68 | 0.72 | 0.81 | — |
| + BM25 融合（Hybrid） | 82.6% | 0.79 | 0.80 | 0.85 | **+11.3pp** |
| + Rerank 交叉编码器（BGE-Reranker-Large） | **89.4%** | **0.87** | **0.86** | **0.90** | **+18.1pp** |
| + GraphRAG（跨文档关系类问题子集） | 83.1% → **91.5%** | 0.82 → **0.89** | — | — | **+8.4pp**（子集） |
| + RAPTOR 层次摘要（长文 / 概括类问题子集） | 65.2% → **84.7%** | 0.61 → **0.83** | — | — | **+19.5pp**（子集） |

**Text2SQL golden 集**（`tests/knowledge_source/golden_text2sql.json`，覆盖 7 种方言、单表 / 多表 JOIN / 聚合 / 子查询）：本版用 LangChain 1.x `with_structured_output` 替换旧正则 `_extract_json` 后，**执行通过率从 90.2% 提升到 99.1%**，SQL 解析错误类故障接近归零。

**端到端冒烟**（`smoke_report.json`，覆盖 health / auth / kb / ks / governance / storage / image / chat / tools 共 9 组 30 个核心用例）：**30 / 30 全部通过**，0 失败，P95 延迟 < 400ms。

> 说明：以上数字基于内部 golden 与冒烟数据集，**模型仍为用户自选**（默认 `bge-large-zh-v1.5` 作 Embedding、`bge-reranker-large` 作 Rerank、`Qwen2.5-14B-Instruct` 作答），不同语料与模型组合下绝对值会浮动，但相对提升量级在公开 RAG 评测（MTEB / BEIR / MS MARCO）趋势内。用户可用自己的 golden 集 `POST /eval/run` 一键复现。

## 三、多源知识接入（Text2X）

`knowledge_source` 模块把 **关系型数据库、MongoDB、Elasticsearch** 抽象为同构 Connector，由 `router` 用 structured output 智能路由到合适的源，并通过 `orchestrator` 并行检索、合流聚合。内置能力：

- **Text2SQL 多方言**：一份 Connector 覆盖 **MySQL（pymysql）、PostgreSQL（psycopg2/psycopg）、SQLite（内建）、Microsoft SQL Server（pyodbc / pymssql，支持 ODBC Driver 18）、Oracle（oracledb / cx_Oracle Thin 模式）、ClickHouse（clickhouse-sqlalchemy + http/native 子驱动）、Apache Doris（兼容 MySQL 9030 端口）**。URL 由 `dialects.py` 自动拼装，驱动按优先级探测并在缺包时给出友好 pip 提示；`safety` 模块拦截非只读语句，`tenant_guard` 在查询层自动注入 `tenant_id` WHERE，`sqlglot` 做跨方言 AST 校验防注入。
- **Text2Mongo**：同步 / 异步（`async_connector`）双栈，LLM 直出 MongoDB 聚合管道并在沙箱执行。
- **Text2ES**：自然语言 → Elasticsearch DSL，支持同步与异步客户端。
- **GraphText2SQL**：LangGraph 驱动的"schema 检索 → 生成 → 执行 → 自纠错"多步回路，复杂多表联查稳定性显著提升。

## 四、图像检索

全新 `image_source` 模块提供 `kind=image` 的知识源：基于 SigLIP 等跨模态 embedding 模型，同时支持**文本查图**与**以图搜图（search_by_image）**。索引走统一 store 抽象，可与文本 KB 并列参与多源 orchestrator 检索，检索结果以标准 RetrievalChunk 归一返回，便于下游 LLM 引用。

## 五、智能体与工具生态

智能体执行层从传统 ReAct 升级到 **LangGraph `create_react_agent`**，原生支持并行工具调用与 human-in-the-loop 中断。工具仓已扩展至 30+，覆盖：

- **检索类**：`search_internet`、`search_local_knowledgebase`、arxiv、pubmed、wikipedia、semantic_scholar、stackexchange、YouTube、news_api；
- **开发协作**：GitHub、GitLab、Confluence、Notion、`http_request`、`url_reader`、`openapi_call`；
- **生活信息**：高德 POI / 天气、openweather、weather_check、Wolfram、雅虎财经；
- **执行沙箱**：`python_repl`、`shell`；
- **生成类**：`text2image`、`text2sql`、`text2promql`。

用户还可通过 `custom_tools_runtime` 与 `websocket_tools_runtime` 以 OpenAPI/WS 协议注册**自定义工具**，无需改代码即可热插拔。

## 六、消息对接与推送

内置 **钉钉（dingtalk_message）、飞书（lark_message）、企业微信（wechat_work_message）** 三大主流 IM 工具，Agent 可直接将回答、告警或审批结果推送到群/个人。对外方向提供 `/openapi/v1/ws` 长连接端点：外部 App 用 `X-App-Id / X-Timestamp / X-Sign` HMAC-SHA256 签名握手后，按 `op=subscribe/unsubscribe/ping` 订阅事件；服务端在 `callback_dispatcher` 产生事件时，由 `ws_hub` 同步广播至匹配连接，实现毫秒级实时推送。

## 七、开放平台 OpenAPI 与 MCP

`/openapi/v1/*` 下所有 REST 接口由 `AppAuthMiddleware` 统一校验三件套签名，内置 `/ping`、`/echo`，并预留 chat / kb / tools 封装端点。同时内置 **MCP Server**（`chayuan.server.mcp_server`），把 Text2SQL、多源检索、工具调用以 MCP 协议暴露，可被 Claude Desktop、Cursor 等 MCP 客户端直接消费；反向也支持消费外部 MCP 服务，形成双向生态。

## 八、多用户鉴权与数据隔离

- **账号体系**：JWT 登录 / 注册，`admin` / `user` 双角色；密码以 **bcrypt / scrypt** 加盐存储；启动时用户表为空自动种子管理员账号（密码写入启动日志）。
- **元数据库**：关系元数据统一走 SQLAlchemy，开发态 SQLite 开箱即用，生产态推荐 **PostgreSQL**（`docker/prod` 模板默认）；向量元数据与业务数据解耦。
- **知识库 ACL（KB）**：每个 KB 有 `owner_id` + `visibility ∈ {private, public}`，`kb_access_grants` 表按 `(kb_id, user_id)` 授予显式角色。访问层 `auth/access.py` 统一返回四态：
  - **owner**（创建者或 admin，全权）
  - **editor**（显式授权，可读写、可追加授权）
  - **reader**（显式授权或 `visibility=public` 的登录用户）
  - **None**（无权，列表与查询均被过滤）
- **知识源 ACL（Source）**：`knowledge_source` 复用同套三态授权，`source_access_grants` 与 `visibility` 对齐 KB 语义，保证 Text2SQL / Text2Mongo / Text2ES 的数据库连接也受控；`filter_accessible` 在多源并行检索时提前剔除无权源，避免泄漏。
- **租户隔离**：`TenantContextMiddleware` 紧邻 `AuthMiddleware` 注入 `request.state` 上下文；SQL 源再叠加 `tenant_guard` 在 WHERE 层强制 `tenant_id`，为多租户 SaaS 场景提供行级隔离基石。
- **开放平台鉴权**：`/openapi/v1/*` 走 HMAC-SHA256 `X-App-Id / X-Timestamp / X-Sign` 三件套（body 参与签名、时间戳防重放），`AppSpec` 支持 scopes 细粒度端点授权。
- **降级兼容**：`AUTH_REQUIRED=false` 或未登录场景自动放行，保持单机调试体验不被打断。

## 九、治理、合规与安全

- **配额 Quota**：Redis 令牌桶控 QPS + 日 token 预算，Redis 故障时 fail-open 不阻断业务。
- **PII 脱敏与 Masking**：入参/出参双向扫描，合规策略可按用户/角色/全局三级覆盖。
- **Guardrails**：Nemo Guardrails → Llama Guard → Rules → Noop 四级自动降级，内容安全可热切换。
- **血缘 Lineage**：记录问答所引用的文档、源、字段，便于审计与"出处可追"。

## 十、文件存储（本地 / MinIO / S3）

`file_storage` 抽象出统一 `FileStorage` 接口，通过 `factory.py` 按 `FILE_STORAGE_BACKEND` 切换后端，并支持**全局默认 + 按 KB 覆盖**两级选型：

- **LocalStorage（本地盘）**：默认后端，直接落盘到 `CHAYUAN_ROOT` 数据目录，适合单机 / 开发 / Docker 单容器场景。
- **MinioStorage（MinIO / S3 兼容对象存储）**：仅需配 `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_SECURE`、`MINIO_REGION` 即可启用；`MINIO_BUCKET_PREFIX` 自动为 chat 临时文件、图像、KB 原始件建独立桶，`MINIO_BUCKETS` 支持桶名 override，满足合规/冷热分层需求。可无缝对接 AWS S3、阿里云 OSS（兼容模式）、腾讯云 COS、Cloudflare R2 等任意 S3 协议对象存储。
- **按 KB 粒度覆盖**：`knowledge_base.storage_backend` 字段允许**同一套服务下不同 KB 走不同后端**（如敏感 KB 走私有 MinIO、公共 KB 走本地），实例按 backend 名缓存，避免连接池浪费。
- **故障自愈**：MinIO 初始化失败（缺 `minio-py` / 凭据错 / 网络不通）自动降级 LocalStorage 并在 `/storage/status` 打告警，保证业务不中断；`reset_cache()` 支持热更新后无感生效。

## 十一、可观测性与可扩展运行时

Prometheus `/metrics`、结构化 JSON 日志（每条带 `X-Request-ID`）、可选 OpenTelemetry 与 Langfuse 深度追踪；`/healthz`、`/readyz` 与配置面板健康检查保障就绪探针可靠。Arq + Redis 异步入库队列（`chayuan worker`）让 10k+ chunk 的大型 KB 上传不再阻塞 HTTP；多 Worker、连接池、速率限制、统一文件存储抽象，配合 `docker/prod` 一键拉起 **PostgreSQL + Redis + Milvus + MinIO + chayuan-api + chayuan-worker + chayuan-webui + chayuan-panel**，可平滑扩展至 5000 并发。

## 十二、配置面板与评测

**NiceGUI Config Panel** 一站式管理模型、数据库、Redis、存储、向量库、KB、KB ACL、用户、Apps、自定义工具、WebSocket 端点、MCP、监控、性能与扩容。内置 RAGAS 评测 Runner，每次 Prompt 改动可在 CI 跑 faithfulness / answer_correctness / context_precision，量化回归。

**立即体验**：`pip install chayuan-server -U && chayuan init && chayuan start -a`。

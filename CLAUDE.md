# CLAUDE.md — chayuan-desktop（单机版总入口）

本文件是 Claude / AI 助手在本工作区的强制约束。每次进入 `/work/chayuan-desktop` 都必须先读完本文件，再决定如何动手。

> 工作区约定：
> - 前端项目：`/work/chayuan-desktop/chayuan-client`（pnpm workspace，Tauri 2 + React 19，apps/{desktop,web} + packages/{app,api,transport,ui,...}）。
> - 服务端项目：`/work/chayuan-desktop/chayuan-server`（FastAPI / Python / Poetry，libs/chayuan-server 为可安装包与 `chayuan` CLI）。
> - 二者通过 HTTP / OpenAPI 契约耦合，无 Node↔Python 代码直连。
> - 本工作区的目标是把现有 SaaS 形态裁剪为「装完即用、全离线、单机、不登录、不依赖 Redis」的桌面产品，三平台（Linux / macOS / Windows）一键安装即可运行。

---

## 0. 永久任务清单（每次都要记住）

下列条目是用户长期生效的需求，所有未来对话默认遵循，除非用户明确撤销：

### 0.1 模块裁剪（前后端同步删除）

- [ ] **(1) 移除「察元办公」模块**：删除前端 `features/office`、`api/office.ts`、相关路由/Shell 入口；删除服务端 `chayuan/server/api_server/office_*.py`、`office_acl.py`、`office_share_routes.py`、`office_vectorize_routes.py`、`office_assistant_runtime.py`、`office_fast_ingest.py`、`office_group_routes.py`、`_office_blank.py`，以及 `agent/`、`kb_query/`、`retrieval/` 内 office 相关 adapter、`auth` 与 `governance` 中 office 权限分支。涉及 `ku_ids` 时只保留 `doc:*` / `src:*`，删除 `office:*`。
- [ ] **(2) 移除「智能空间」模块**：删除前端 `features/space`、`api/ai-space.ts`、`api/aiSpaceApps.ts`、`api/aiSpaceEval.ts`、`api/aiSpaceTasks.ts`；删除服务端 `chayuan/server/ai_space/` 整包及 `api_server/ai_space_routes.py`、`ai_space_embed_routes.py`，以及 evaluation 链路里只服务 ai_space 的部分。
- [ ] **(3) 移除「应用市场」模块**：删除前端 `features/marketplace`、`api/marketplace.ts`；删除服务端 marketplace 相关路由与服务（如有 `marketplace`/`applications`/`app_store` 命名的 router，一并清掉），并清理 catalog 类查询中 marketplace 维度。
- [ ] **(4) 移除「我的待办」模块**：删除前端 `features/tasks`（注意区分 LangGraph 内部的 task 与"我的待办"业务任务）、相关 API；删除服务端"我的待办"相关 ORM、路由、调度器。注意保留通用任务/作业基础设施（ingest_queue 之类）。
- [ ] **(5) 留空（用户跳号）**。
- [ ] **(6) 模型广场重构**：见 §1。
- [ ] **(7) 离线打包**：见 §2 + §3。
- [ ] **(8) 单机模式整体架构**：见 §3 + §4。

> 删除规则：**前后端同步删，先删后端路由再删前端调用**，避免悬空 import。每删一个模块要顺手清理 i18n 文案、路由表、Shell 导航、CapabilityRouter / FeatureFlag 中的开关。删除后跑一次 `pnpm typecheck`、后端 `pytest -q`，确认无残留引用。

### 0.2 不可越界的产品红线

- 单机模式默认**不登录、不展示登录页**，启动即进主界面。保留代码层的"本地用户"概念（可自动生成默认 `local-user`），但 UI 不暴露。
- **不依赖 Redis、Celery、RabbitMQ、外部 Postgres、外部 ES**。任务队列、缓存、限流、分布式锁全部退化为进程内实现。
- **不要求联网**：装完 + 配好模型即可全功能运行。所有「在线服务」（Langfuse、远程同步、外部向量库）默认 `disabled`，仅在用户开启后启用。
- **不引入特殊系统依赖**：不再要求安装独立 Python、Node、Poetry、Postgres、ffmpeg-source-build、tesseract-source-build；所有运行依赖随安装包打包。
- 安装阶段仅询问一个东西：**数据目录**（默认平台标准目录，可改）。其它一律零配置。

---

## 1. 模型广场重构（永久）

目标：**模型广场 = 模型厂商配置中心**，不是模型选择器。模型选择器在对话框、知识库等具体场景里独立存在。

### 1.1 UI 形态

- 顶部分类 Tab（左到右）：**推荐 / 全部 / 本地 / 国内 / 国外 / 聚合 / 自定义**。
  - 推荐：内置精选（OpenAI、Anthropic、Google、DeepSeek、通义、智谱、本地 Ollama 等）。
  - 本地：Ollama / llama.cpp / LM Studio / vLLM 等本机推理后端。
  - 国内：DeepSeek / 通义千问 / 智谱 / Moonshot / 百川 / MiniMax / 字节豆包 / 阶跃 / 零一 / 腾讯混元 / 讯飞 / SiliconFlow（硅基流动）等。
  - 国外：OpenAI / Anthropic / Google / Mistral / Cohere / xAI / Together / Groq / Fireworks / OpenRouter（如归到聚合也可）等。
  - 聚合：OpenRouter / OneAPI / NewAPI / FastChat 等代理网关。
  - 自定义：用户自填的任意 OpenAI 兼容 endpoint。
- 卡片网格：每个**厂商**一张卡片（不是模型一张卡片），卡片显示 logo、名称、状态徽标（已配置 / 可用 / 未配置 / 失败）、模型计数。
- 点击卡片 → 抽屉 / 详情页：
  - 字段：API base、API key、自定义 header、代理、超时、并发上限。
  - 操作按钮：**测试连通性**（拉一次 `/v1/models` 或 ping）、**抓取模型列表**、**保存**、**清空**、**删除**。
  - 模型列表（仅在该详情内）：可启停每个模型、设置别名、为类型打标签（chat / embedding / rerank / vision / tts / stt）。
- 顶部"添加厂商"按钮：弹窗选择「OpenAI 兼容 / Anthropic 兼容 / Ollama 兼容 / 自定义协议」+ 名称 + endpoint + key，存到自定义分类。

> **不要再在模型广场页面外层做"模型平铺列表"**。模型只在厂商详情里展示。

### 1.2 数据与 API（直通后台）

- 后端单一真源表：`model_provider`（厂商）+ `model_record`（厂商下模型），由 `model_registry` / `chayuan-modelmgr` 提供。
- 前端 API 层（`@chayuan/api`）只暴露一组 CRUD：
  - `GET /v1/providers?category=recommended|all|local|cn|global|gateway|custom`
  - `POST /v1/providers`（新增）
  - `PATCH /v1/providers/:id`（修改）
  - `DELETE /v1/providers/:id`
  - `POST /v1/providers/:id/test`（验证可用性，返回 latency / error / 抓到的模型清单）
  - `POST /v1/providers/:id/refresh-models`（拉模型列表）
  - `GET /v1/providers/:id/models` / `PATCH /v1/providers/:id/models/:model_id`（启停、别名、能力标签）
- 现有 `aiPlatform.ts` / `modelPlatform.ts` / `imageModels.ts` 三套 API 收敛到这一组。`features/aiPlatform` 改名为 `features/providers`，作为模型广场页面的实现。
- **单机版没有"用户级配置"**：后端这些接口不读 `current_user`，全部走全局配置。前端不需要 per-user 缓存键。

### 1.3 验证连通性的逻辑

- OpenAI 兼容：`GET {base}/v1/models` 带 Bearer key；解析出模型列表。
- Anthropic：`POST {base}/v1/messages` 带最小 prompt（或读 `/v1/models` 若官方上线）。
- Ollama：`GET {base}/api/tags`。
- 自定义：用户选择基协议，复用对应探测器。
- 探测结果分三档：✅ 可用、⚠️ 可达但 key 无效、❌ 不可达；UI 颜色和提示分级。

---

## 2. 离线打包与数据目录（永久）

### 2.1 数据目录策略

- 安装时**只问一个问题**：「选择数据目录」。默认值按平台：
  - macOS: `~/Library/Application Support/Chayuan`
  - Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/Chayuan`
  - Windows: `%APPDATA%\Chayuan`
- 数据目录布局（固定）：

```
<DATA_DIR>/
├── chayuan.sqlite           # 主库（业务）
├── chayuan_meta.sqlite      # 元数据 / 迁移版本
├── vectors/                 # 本地向量库目录（见 §2.3）
├── files/                   # 上传 / 解析的原文件
├── models_cache/            # 模型权重 / embedding 缓存
├── logs/
├── tmp/
└── config.toml              # 用户配置（含选择的数据目录路径回写）
```

- 路径写入 `~/.config/chayuan/data_dir`（Linux/mac）或注册表（Windows），便于卸载/迁移。
- 服务端启动时通过环境变量 `CHAYUAN_DATA_DIR` 注入；所有相对路径一律改为相对该变量，禁止硬编码 `./data` 或仓库内 `chayuan_data/`。

### 2.2 SQLite 选型

- **业务主库**：SQLite + WAL 模式 + `synchronous=NORMAL`，开启 FTS5 全文索引。
- 替代当前可能用到的 Postgres：把 SQLAlchemy 方言切到 sqlite，慎用 PG 专属类型（`JSONB`、`ARRAY`、`tsvector` 等），统一用 `JSON` + 应用层处理。
- 迁移工具：alembic 单一 head，启动时自动 `upgrade head`，无需用户介入。
- 桌面端（Tauri）保留 `platform-tauri` 中的 SQLite 客户端用于本地缓存（会话/outbox），与服务端 SQLite **不共享同一数据库**——服务端是后台真源，客户端 SQLite 只是 UI 缓存。

### 2.3 本地向量库选型（必须无外部依赖）

候选并排序（自上而下优先）：

1. **`sqlite-vec`**（推荐）：纯 C 扩展，单文件 .so/.dylib/.dll，可与业务 SQLite 同库共存，支持 KNN + metadata filter。
2. **`lancedb`**（次选）：纯 Python + Rust，本地目录存储（Lance 格式），支持向量 + 全文，无服务进程。
3. **`chromadb` 嵌入式模式**（备选）：成熟但启动较慢、依赖较重。
4. ⚠️ **不选**：Milvus / Qdrant / Weaviate / Elasticsearch（需独立服务）、FAISS 裸用（无元数据）。

>实现要求：在 `chayuan/server/retrieval/` 新增 `vector_store_local.py`，定义 `LocalVectorStore` 接口，默认实现 `sqlite-vec`。所有现有 milvus / qdrant 调用走适配层；单机模式下编译时即排除外部 store 的 import 链。

### 2.4 嵌入与重排模型

- 默认随安装包**预置一个 ONNX 量化的中文+多语 embedding**（如 `bge-m3-onnx-int8`）+ 一个轻量 reranker（可选）。
- 推理走 `onnxruntime` CPU；无需 CUDA、无需 PyTorch 运行时（PyTorch 仅作为打包时的转换工具，不进运行时镜像）。
- 用户可在模型广场切换为云端 embedding（如 OpenAI text-embedding-3-small），但默认本地。

### 2.5 三平台打包路线

- **服务端**：用 **PyInstaller**（或 **Nuitka**）把 `chayuan-server` 打成单可执行：
  - 入口：`chayuan start -a --single-machine`
  - 打进去：Python 解释器、所有 wheels、ONNX 模型权重、sqlite-vec 扩展、SSL 证书、字体（用于 PDF 渲染）。
  - 不打进去（运行时由数据目录提供）：用户数据、用户上传文件。
- **前端**：用 **Tauri 2** 的 sidecar 机制把上面的服务端可执行嵌入：
  - `apps/desktop/src-tauri/tauri.conf.json` 的 `bundle.externalBin` 增加 `chayuan-server-<triple>`。
  - Tauri 启动时 spawn sidecar 监听 `127.0.0.1:<random_port>`，通过本地端口与前端通信；端口随机化避免冲突。
  - 退出 Tauri 时回收子进程（使用 `tauri-plugin-shell` 的 `Command` 与 `on_window_event(CloseRequested)`）。
- **目标产物**（与 chayuan-client 既有 ARCHITECTURE.md 一致）：
  - Linux: `.deb` + `.AppImage`（含 sidecar）
  - macOS: `.dmg` / `.app`（公证后），ARM64 + x86_64 双架构
  - Windows: `.msi` + `.exe`（带签名）
- **CI 矩阵**：GitHub Actions 三平台 runner；每平台先 build chayuan-server 单可执行 → 拷到 `apps/desktop/src-tauri/binaries/` → `pnpm build:desktop`。

---

## 3. 架构师视角：从安装到使用的端到端规划

> 最高目标：用户**双击安装包 → 选数据目录 → 启动 → 配模型 → 立刻能用全部功能**。除了「选数据目录」和「配模型」，不应有任何其他必填步骤。

### 3.1 启动序列（单进程视角）

```
用户双击桌面图标
   │
   ▼
Tauri 主进程拉起
   │ 1) 读取 ~/.config/chayuan/data_dir，没有就弹一次 Setup 对话框（仅首次）
   │ 2) 写入选择的 DATA_DIR 到本地配置
   ▼
spawn 服务端 sidecar（chayuan-server 单可执行）
   │ env: CHAYUAN_DATA_DIR=<DATA_DIR>
   │      CHAYUAN_PROFILE=single-machine
   │      CHAYUAN_AUTH=anonymous
   │      CHAYUAN_REDIS=disabled
   │      CHAYUAN_QUEUE=inproc
   │      CHAYUAN_VECTOR_STORE=sqlite-vec
   │ port: 127.0.0.1:<random>
   ▼
服务端 bootstrap（按顺序，可并发）
   │ a) 解压预置资源（首次）：embedding 权重 / sample KB / 默认 prompts → DATA_DIR
   │ b) alembic upgrade head
   │ c) 初始化 sqlite-vec 扩展、本地 KB 默认 collection
   │ d) 加载本地 user（local-user，固定 id），生成本地 token（仅前端 sidecar 间通信使用）
   │ e) 启动 FastAPI（uvicorn 单进程 + asyncio）
   │ f) /healthz 200 之后才往 stdout 输出 READY 行
   ▼
Tauri 监听 sidecar stdout，捕获 READY 行后
   │ 把 base_url + 本地 token 通过 platform-tauri 注入到 @chayuan/api
   ▼
前端进入主界面（直接进首页，不弹登录）
   │ 首次启动检测：是否已配模型 → 没配则在首页/Shell 顶部贴一个非阻塞提示条
   │ "尚未配置模型 → 去模型广场" （不强制跳转）
   ▼
用户配完任一可用模型 → 全功能立即可用
```

### 3.2 进程拓扑

- 单机模式只有 **2 个进程**：Tauri 主壳 + 服务端 sidecar。
- 服务端内部线程：
  - 主 asyncio loop（HTTP / SSE）
  - 后台任务线程池（解析 / 入库 / embedding），队列走 `asyncio.Queue` + `concurrent.futures.ThreadPoolExecutor`，**不引入 Celery**。
  - 文件监听（可选，用于本地知识库 hot reload）。
- 不再使用 supervisor / chayuan-supervisor 多进程协调（保留代码但单机版不启用）。

### 3.3 单机模式 Profile（后端）

新增 `chayuan/server/profiles/single_machine.py`，集中开关：

| 能力 | 单机模式 | 多用户/SaaS（保留代码） |
|---|---|---|
| 鉴权 | anonymous（自动注入 local-user） | JWT / OAuth |
| 缓存 | `cachetools.TTLCache` | Redis |
| 队列 | `asyncio.Queue` + 线程池 | Celery + Redis/RabbitMQ |
| 限流 | 进程内令牌桶 | Redis 分布式 |
| 全文检索 | SQLite FTS5 | ES / OpenSearch |
| 向量 | sqlite-vec | Milvus / Qdrant |
| 关系库 | SQLite + WAL | PostgreSQL |
| 对象存储 | 本地文件 | S3 / OSS |
| 可观测 | 本地 OTLP file exporter（默认关）+ 本地日志 | Langfuse / Prometheus |
| 模型 | 本地 ONNX + 用户配置厂商 | 同 + 内部模型网关 |

切换由环境变量 `CHAYUAN_PROFILE=single-machine` 一次性决定，**不要把分支撒在业务代码里**，在 bootstrap 阶段挑实现。

### 3.4 鉴权与"无登录"实现

- `auth` 模块保留，但在 single-machine profile 下：
  - `dependency: get_current_user()` 返回固定的 `LocalUser(id="local", roles=["owner"])`。
  - 不渲染 `/login` 路由；前端 `auth-store` 的 `me()` 在该模式直接返回本地用户。
  - 所有"按用户隔离数据"的查询保留 user_id 列，但只会有一个值，便于将来切回多用户。

### 3.5 知识中心、对话、MCP 工具中心、历史会话即开即用

- **新建对话**：完全不依赖任何外部模型存在；进入对话页时，如未配模型则显示空状态卡 + 一键跳到模型广场。配完后输入框立即可用。
- **知识中心**：默认有一个"我的知识库"（doc:default），用户拖进文件即开始本地解析+embedding+sqlite-vec 入库；解析进度通过 SSE 推到前端。
- **模型广场**：见 §1，零依赖即可使用（即使一个厂商都没配也能进页面）。
- **工具中心 / MCP**：内置一组"safe local tools"（计算器、本地文件读、当前时间、shell 受限子集），开关默认关；用户可加 stdio / sse MCP server，不需要登录态。
- **历史对话**：会话与消息存 SQLite，按 user_id=local 过滤；首次启动表为空，自动生成"欢迎"会话或保持空。

### 3.6 错误兜底与可降级

- 服务端 sidecar 崩溃：Tauri 监听退出码，自动重启，三次失败后弹错误窗（含 logs 路径 + "导出诊断包"按钮，打包 logs/ + config.toml + 版本号 zip）。
- 模型不可用：UI 顶部 banner，但不阻塞其它无模型功能（如查看历史、管理 KB 文档）。
- 数据目录写入失败 / 磁盘满：bootstrap 阶段直接拒绝启动，引导用户改数据目录。

### 3.7 关键风险与对策

| 风险 | 对策 |
|---|---|
| PyInstaller 打包后启动慢 | 用 `--onedir` 而非 `--onefile`；首次启动有 splash；冷启动目标 < 3 秒。 |
| Windows Defender 误报 sidecar | 代码签名（EV 证书）；打包脚本内嵌版本元信息。 |
| macOS 公证 | Tauri 已有方案，CI 内嵌 notarize 步骤。 |
| Python 多进程在 sidecar 里会触发"自我重启" | 强制 `multiprocessing.set_start_method('spawn')` 并在 sidecar 入口 `freeze_support()`。 |
| sqlite-vec 在 ARM Windows 缺编译 | CI 三架构都跑；缺平台时 fallback 到 lancedb。 |
| 用户改数据目录后老数据丢失 | 提供"切换数据目录"向导：复制旧库 → 校验 → 切换；不要静默重建。 |
| ONNX 模型权重体积大（200MB+） | 安装包内置一个最小 embedding；reranker / vision 模型按需在线下载到 `models_cache/` 并校验 sha256（用户可拒绝下载）。 |

### 3.8 验收清单（单机版 v1 GA）

- [ ] 三平台均可双击安装；macOS 公证通过；Windows 通过 SmartScreen。
- [ ] 安装完成后 30 秒内进入主界面，不要求联网。
- [ ] 不出现登录页 / 不出现注册页 / 不出现工作区切换。
- [ ] 首次进入模型广场分类正确，"测试连通性"对内置厂商可用。
- [ ] 配置任一可用厂商后：新建对话、上传文件到默认 KB、对该 KB 提问、添加 MCP 工具、查看历史，全部 happy path 走通。
- [ ] 进程退出后 sidecar 也退出（不留僵尸）。
- [ ] 切换数据目录的向导能保留旧数据。
- [ ] 关闭网络拔网线，仍可进行：本地模型对话、本地 KB 检索、查看历史、修改设置。
- [ ] `chayuan-client` `pnpm typecheck` 0 错误；`chayuan-server` `pytest -q` 全绿。

---

## 4. 开发与协作约束（每次都要遵守）

### 4.1 项目分工

- 前端改动一律在 `chayuan-client/`。
- 服务端改动一律在 `chayuan-server/`。
- 跨端契约改动需同时改两侧并通过 `pnpm gen:api` 重新生成类型。

### 4.2 提交与分支

- 两个项目都在固定分支上工作（沿用 `/work/CLAUDE.md` 既有规则）：`chayuan-client` → `main`，`chayuan-server` → `main`。
- 不创建 `feature/*` / `fix/*` 临时分支。
- 未经用户明确指示**不提交、不 push**。
- 涉及删除大模块的改动，commit 应分批：`chore(office): remove office module`、`chore(space): remove ai-space module`、`chore(marketplace): remove marketplace module`、`chore(tasks): remove my-tasks module`。

### 4.3 验证命令（最低一次）

- 前端：`pnpm typecheck` + 触达文件 `pnpm lint --filter <pkg>`。
- 后端：`PYTHONPATH=libs/chayuan-server pytest -q tests/unit_tests/`，必要时 `python -m py_compile <changed>`。
- 单机模式相关变更：本地起一次 `chayuan start -a` + `pnpm dev:desktop`，最少跑通 §3.8 验收清单的子集。

### 4.4 风格

- 用中文回答。先结论，后改动，再验证结果。
- 删模块时 **先列出所有引用点再批量删**，不要边删边发现新引用。
- 不要"顺手重构"无关模块。
- 不要在 SaaS 代码路径里硬编码删除——保留接口，单机 profile 选不同实现。

### 4.5 红线

- 不允许在前端硬编码登录态 / 工作区切换 UI。
- 不允许在服务端 import `redis` / `celery` / `kombu` 到默认启动路径。
- 不允许把模型 API key 写入业务库；统一走 `model_provider` 表（应用层加密）。
- 不允许把数据目录硬编码为仓库内相对路径。
- 不允许在没跑 typecheck / pytest 的情况下声明任务完成。

---

## 5. 当前状态速查（写于 2026-05-07，可能过期，怀疑就 grep 验证）

- 前端 `packages/app/src/features/` 仍包含 `office/` `space/` `marketplace/` `tasks/`，待移除。
- 前端 `packages/api/src/` 仍包含 `office.ts` `ai-space.ts` `aiSpaceApps.ts` `aiSpaceEval.ts` `aiSpaceTasks.ts` `marketplace.ts`，待移除。
- 服务端 `chayuan/server/` 仍包含 `ai_space/` `ai_platform/` 子包，`api_server/` 中仍有 `office_*.py` `ai_space_*.py` 等路由，待移除。
- 模型广场当前由 `aiPlatform.ts` / `modelPlatform.ts` / `imageModels.ts` 多源混合，后续按 §1.2 收敛。
- 服务端默认还在依赖 PG / Redis 假设；single-machine profile 尚未建立。

完成本文件 §0 / §1 / §2 / §3 列出的所有事项即视为单机版 v1 完成。

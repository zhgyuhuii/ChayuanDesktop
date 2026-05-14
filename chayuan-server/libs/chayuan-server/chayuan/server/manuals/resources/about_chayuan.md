# 关于察元 AI

> 把办公场景的 AI 助手做到本地、安全、可信。
> 版本：v3.0 · 发行渠道：桌面版（chayuan-desktop）+ WPS 加载项（chayuan）
> 许可：AGPL-3.0 · Dual License 商业授权可选 · 主站：chayuan.ai

---

## 我们是谁

**察元（Chayuan）** 是一套面向办公场景的 AI 助手系统，由"察元 AI"团队设计与维护。我们做的不是"再一个 ChatGPT 客户端"，而是一整套**端到端**的智能办公基础设施：

- 在用户的电脑里跑模型 —— 不要求联网；
- 在用户的硬盘里存数据 —— 不要求上云；
- 在用户的工具里嵌入能力 —— WPS / Office / 桌面 / 命令行都能用。

> 我们相信"AI 助手"应该像电脑里的剪贴板和文件管理器一样：**默认本地、随时可用、不监视用户**。

---

## 三个项目，一套系统

| 项目 | 角色 | 技术栈 |
|---|---|---|
| **chayuan-desktop** | 桌面端（Tauri 2 + React 19）+ 用户主入口 | TypeScript / pnpm workspace |
| **chayuan-server** | 服务端（FastAPI + Pydantic v2 + SQLAlchemy）+ RAG / 模型网关 / 数据存储 | Python 3.12 |
| **chayuan**（WPS 加载项） | WPS 侧边栏 AI 助手；文档操作、知识库绑定、引用展示 | JavaScript + Vue SFC |

三个项目不是孤立的仓库。开发时它们被当成**同一个系统**——WPS / 桌面选择知识源，服务端统一查询，前端展示证据和执行结果。

---

## 核心能力（9 类 capability）

察元 AI 把"模型能力"统一抽象成 9 类 capability，每一类都可在 GUI / CLI 切换默认模型：

| Capability | 默认模型（集成版） | 用途 |
|---|---|---|
| **对话 (chat)** | Qwen3-4B-Instruct | 多轮对话、写作、推理 |
| **文本向量 (embedding)** | bge-m3 | 知识库索引、语义检索 |
| **重排 (rerank)** | bge-reranker-v2-m3 | 检索后精排，提升相关性 8-15% |
| **图像向量 (clip)** | jina-clip / SigLIP | 图像知识库、多模态检索 |
| **语音识别 (asr)** | whisper-tiny / FunASR | 录音转写、视频字幕 |
| **语音合成 (tts)** | Piper / CosyVoice | 朗读消息、语音通知 |
| **文生图 (t2i)** | Stable Diffusion 3 / Flux | 配图生成 |
| **文生视频 (t2v)** | AnimateDiff（实验） | 短视频生成 |
| **图像识别文字 (ocr)** | RapidOCR / PaddleOCR | 扫描件 / 截图文本提取 |

所有 capability 走统一路由（`capability_router.resolve_model(cap)`），UI 改 / yaml 改 / CLI 改任一处，业务侧零修改、下次请求拿到新值。

---

## 知识源（3 类 KB）

察元把"知识"也做了一层抽象。所有功能都以 `ku_ids` / `KnowledgeRef` 作为真源选择，三类知识源用前缀区分：

```text
doc:<kb_name>             ← 文档知识库（PDF / Word / Markdown / 网页）
src:<source_id>           ← 结构化 / 图像 / 向量 source（SQL 库、Milvus、Qdrant …）
office:<owner>[:<group>]  ← 办公私库（隐私域，永不上云）
```

服务端统一查询入口：

```http
POST /api/v1/kb-query/search
```

旧接口（`/knowledge_base/search_batch` / `/knowledge_universe/ask` / `/knowledge_base/search_docs`）仅作为兼容层保留。

---

## 查询引擎分层

服务端的查询逻辑保持"路由无关"，按职责分层：

```text
API route
  → kb_query.service
    → retrieval.query.orchestrator
      → refs / authz / router / adapters / results
```

- **refs**：解析 `doc:* / src:* / office:*`
- **authz**：统一用户、应用、游客权限判断
- **router**：识别 5 类意图 —— `document_qa / structured_aggregate / structured_lookup / vector_semantic / multi_source`
- **orchestrator**：并发、超时、错误隔离、trace、结果聚合
- **adapters**：按类型实现 `document / structured / vector / office`
- **results**：统一 `QueryBlock / RetrievalHit / Citation / Diagnostic`

API 路由文件只做协议适配、参数校验和身份注入，**不承载大段业务分发逻辑**。这是察元架构的硬性原则。

---

## 装机即用 — 端到端钢索

```
[A] 安装 chayuan-desktop --release lite | standard | pro
        ↓ chayuan-pack fetch + stage
[B] 模型释放到 <CHAYUAN_ROOT>/models/
        ↓ local_index 扫盘
[C] ModelIdentity 5 级识别（GGUF / HF / Diffusers / pipeline_tag / 路径）
        ↓ candidates_bridge 桥接到 capability 候选
[D] 首启 hook 自动 promote 默认（chat / embed / rerank）
        ↓ capability_router 拿默认 model_id
        ↓ path_resolver 翻译成磁盘路径
[E] supervisor 拉起 llama-server / infinity 子进程，args 含 --model <path>
[F] 用户开聊天 / RAG / 重排 ← 全部就绪
```

集成版（standard / pro）装机就走完 [A] → [F]，**用户不用进任何配置页就能用全部功能**。

---

## 隐私 / 离线 / 国产化

### 数据落地

所有用户数据**都在本机**：

| 路径 | 内容 |
|---|---|
| `<CHAYUAN_ROOT>/data/chat_history.db` | 聊天历史（SQLite，加密可选） |
| `<CHAYUAN_ROOT>/data/knowledge_base/` | 知识库元数据 + 向量分区 |
| `<CHAYUAN_ROOT>/models/` | 本地模型权重 |
| `<CHAYUAN_ROOT>/manuals/` | 用户手册（本文档所在） |

**唯一例外**：用户主动用云模型时，对应 prompt 才会发到该厂商。

### 完全离线验证

- 断网后聊天、检索、引用全部可用 ← 集成版断网测试通过；
- Wireshark 抓包，离线场景**无外部请求**；
- 项目 AGPL-3.0 开源，任何人可审代码。

### 国产化全栈

| 维度 | 支持 |
|---|---|
| CPU | 鲲鹏 / 飞腾 / 龙芯（LoongArch64） |
| OS | 麒麟 V10 / 统信 UOS / openKylin / loongnix |
| 数据库 | 达梦 / 金仓 / 神通 / OceanBase |
| LLM | Qwen3 / 文心 / 智谱 / DeepSeek 全自家可用 |
| 嵌入 / 重排 | bge-m3 / bge-reranker-v2-m3（智源） |
| OCR | RapidOCR / PaddleOCR |
| 语音 | FunASR / Piper / CosyVoice |
| 等保合规 | 等保 2.0 三级（chayuan-server 已通过基础测评要素） |

完整国产化栈、无外国组件依赖。

---

## 与同类产品的关键差异

| 维度 | ChatGPT 桌面 | 通义 / 豆包 / 智谱桌面 | 开源工具（Cherry / AnythingLLM / Open WebUI） | **察元 AI** |
|---|---|---|---|---|
| 数据本地 | ✗ 上云 | ✗ 上云 | ✓ | **✓** |
| 完全离线可用 | ✗ | ✗ | 部分 | **✓** |
| 国产 CPU / OS | ✗ | 部分 | 部分 | **✓ 完整** |
| 党政军合规 | ✗ | ✓（绑厂商云） | ✗ | **✓** |
| 默认模型自动指派 | — | — | 需手动配 | **✓ 装机即用** |
| 知识库 RAG | ✗ | 部分 | ✓ | **✓** |
| 结构化数据查询 | ✗ | ✗ | ✗ | **✓ text2sql + AST 校验** |
| WPS / Office 嵌入 | ✗ | ✗ | ✗ | **✓ WPS 加载项** |
| 开源许可 | 闭源 | 闭源 | MIT / GPLv3 | **AGPL-3.0** |
| Dual License 商业 | — | — | 部分 | **✓ 商业版可关 AGPL** |

察元 AI 在"本地 + 国产化 + 知识库 + 等保合规"四个维度同时打满的**唯一开源选项**。

---

## 开源策略

### AGPL-3.0：保护开源生态

社区版采用 AGPL-3.0：

- 任何 fork 必须保持开源；
- 如果做成 SaaS 让外部用户访问，**整个 SaaS 系统必须开源**（这是 AGPL 与 GPL 的关键差）；
- 企业内部使用、个人使用、修改自用 —— 无任何许可问题。

### Dual License：商业版可关 AGPL

企业用户若不愿意公开自家修改，可以购买 **chayuan 商业版**：

- 非 AGPL 许可，自由修改、不必开源；
- 付费授权；
- 一致的代码基线 + 企业级支持。

### SBOM 透明

每次发布都附完整 SBOM（Software Bill of Materials），所有依赖许可一目了然，无许可冲突。

---

## 技术栈速览

### chayuan-desktop（桌面端）

- Tauri 2 + React 19 + Tanstack Router + Tanstack Query + Zustand
- pnpm workspace，packages 含 `api / transport / app / ui / platform-tauri / platform-web` 等
- Apps：`apps/web`（Web 端）+ `apps/desktop`（Tauri 桌面）

### chayuan-server（服务端）

- FastAPI + Pydantic v2 + SQLAlchemy 2
- 子模块：`api_server`（HTTP 路由）/ `kb_query`（统一查询）/ `retrieval`（检索）/ `knowledge_source`（连接器）/ `model_registry`（本地模型索引）/ `manuals`（用户手册）
- Sidecar：通过 Tauri externalBin 嵌入桌面；PyInstaller 三平台打包；vendor / 模型由 `chayuan_packaging` 编排

### chayuan（WPS 加载项）

- JavaScript + Vue SFC
- 组件：`AIAssistantDialog / KbSelectorDialog / KbSourceStrip`
- 服务：`services/kb`（远程知识库连接、检索编排、prompt 注入）

---

## 路线图

### 已完成（v3.0，2026 Q2）

- 模型注册中心 + 5 级 GGUF/HF 识别
- 装机即用：first_launch 自动指派默认 + 用户手册预置
- 模型库自检 + 一键下载（`chayuan-pack` 三档 release）
- 推理引擎进程编排（supervisor + chayuan-server 联动）
- WPS 加载项 v3.0 全功能
- 等保 2.0 三级基础项

### 进行中（v3.1）

- 模型管理面板 GUI 全量化
- 进度 SSE 流式（替代轮询）
- LoongArch64 官方编译流水线
- 内置 MCP server 工具集扩展

### 规划（v4.0）

- 多用户 / 团队空间
- 智能体（Agent）编排
- 增量训练 / fine-tune 入口
- 视频 / 多模态生成

---

## 加入察元

- **GitHub**：项目主仓 + Gitee 镜像（详见主站 GitHub 下拉）
- **文档**：本手册 + `articles/` 系列文章（500+ 篇深度内容）
- **社区**：Issue / Discussion / 邮件列表
- **商业版**：联系 chayuan 商务团队

> 我们相信 AI 不应让人变笨、更不应剥夺人的隐私。察元 AI 是一份给办公场景的工具，也是一份对开源生态的承诺。
>
> 欢迎你来用、来改、来挑刺。

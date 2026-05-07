# 察元 AI 助手服务（chayuan-server）

[![PyPI](https://img.shields.io/pypi/v/chayuan-server.svg)](https://pypi.org/project/chayuan-server/)
[![Python](https://img.shields.io/badge/python-3.8%20|%203.9%20|%203.10%20|%203.11-blue.svg)](https://www.python.org/downloads/)

🌍 [English README](README_en.md)

**察元（chayuan）** 是一套面向企业与个人的 **AI 助手服务**：在本地或私有环境中提供大模型对话、基于知识库的问答（RAG）、Agent 与工具调用等能力，支持离线部署与多种模型接入方式。

---

## 我该用哪种部署？（一图选型）

```text
你需要哪类部署？
    │
    ├── 🟢 个人单机 / 离线 / 一键启动
    │       → 下载 chayuan-{lite|standard|pro}-{平台}.{AppImage|dmg|exe}
    │       → 双击；端口 / 凭据 / 模型自动配置
    │       → docs: docs/install/standalone.md
    │
    ├── 🔵 团队 / 公司局域网 server
    │       ├── 裸机： bash scripts/install_ai_platform.sh && chayuan service start
    │       └── 容器： docker compose -f docker/dev-stack-alt-ports/docker-compose.yml up -d
    │       → 服务端只暴露 API；前端用瘦客户端连
    │       → 桌面瘦客户端： chayuan-client/apps/desktop  pnpm build:thin
    │       → docs: docs/install/server.md
    │
    └── 🔴 多节点 / 集群 / k8s
            → ai_platform_config/profiles/cluster.yaml 起骨架
            → deploy/k8s/  helm chart（v6.2 计划中）
            → docs: docs/install/cluster.md
```

| 决策点 | 单机 | 服务端 | 集群 |
| --- | --- | --- | --- |
| 是否要装 Docker | 否（OnlyOffice 才用） | 可选 | 必须 |
| 默认数据库 | SQLite | Postgres | 外部 Postgres + Milvus |
| 默认对象存储 | 本地文件系统 | MinIO | S3 兼容 |
| 模型镜像源 | hf-mirror.com（默认） | hf-mirror / 内网 | 内网镜像 |
| 推理后端 | ollama 内置 | ollama / vllm | vllm × N + GPU 调度 |

详细决策树 + 三档需求覆盖审计：
[docs/multimodal-ai-platform-requirements-coverage.md](docs/multimodal-ai-platform-requirements-coverage.md)

---

## 目录

* [概述](README.md#概述)
* [功能概览](README.md#功能概览)
* [模型与推理框架](README.md#模型与推理框架)
* [快速上手](README.md#快速上手)
  * [环境要求](README.md#环境要求)
  * [通过 pip 安装](README.md#通过-pip-安装)
  * [准备模型推理服务](README.md#准备模型推理服务)
  * [初始化配置与数据目录](README.md#初始化配置与数据目录)
  * [初始化知识库](README.md#初始化知识库)
  * [启动服务](README.md#启动服务)
* [其它配置](README.md#其它配置)
* [源码与 Docker 部署](README.md#源码与-docker-部署)
* [协议与联系](README.md#协议与联系)

## 概述

察元 AI 助手服务基于 **LangChain** 生态构建，通过 **FastAPI** 对外提供 API，并可选 **Streamlit** Web 界面进行交互。您可以使用主流开源大语言模型、Embedding 与向量库实现 **全链路私有化部署**，也可按需接入兼容 OpenAI API 的云端模型服务。

![](docs/img/langchain_chayuan_0.3.0.png)

典型问答流程包括：加载文档 → 解析与切分文本 → 向量化写入向量库 → 用户提问向量化 → 检索最相关的 `top k` 片段 → 将上下文与问题一并送入 LLM 生成回答。

![](docs/img/langchain+chatglm.png)

从文档与知识库管理视角，整体 pipeline 可概括为下图（具体实现以当前版本代码为准）。

![](docs/img/langchain+chatglm2.png)

> 本服务侧重 **推理与应用编排**，不包含模型微调或训练流程；若您有领域数据，可在模型侧微调后再接入察元以提升效果。

## 功能概览

| 能力 | 说明 |
|------|------|
| 多轮对话 | 支持常见开源与在线 LLM |
| 知识库问答（RAG） | 本地知识库、向量检索与多种检索策略 |
| Agent / 工具 | 在支持的模型上可进行工具选择与参数解析 |
| 文件对话 | 统一为 File RAG，支持多种检索方式 |
| 扩展能力 | 数据库对话、文献检索、多模态（视模型与配置而定）等 |
| Web UI | 多会话、系统提示词等可配置项 |
| **多用户鉴权** | JWT 登录 / 注册，admin / user 双角色，密码 bcrypt/scrypt 存储 |
| **数据隔离 & KB ACL** | 会话 / 消息按用户隔离；知识库 `private / public` 可见性 + 显式 `reader / editor` 授权 |
| **异步入库队列** | KB 上传走 Arq + Redis 后台消费，CLI：`chayuan worker` |
| **语义缓存** | Redis 加速非流式单轮问答（chat / kb_chat），按 user / kb / model 严格隔离 |
| **可观测性** | `/metrics`（Prometheus）+ 结构化 JSON 日志（含 `X-Request-ID`）+ 可选 OpenTelemetry |
| **可扩展运行时** | 多 worker、连接池、速率限制、`/healthz` `/readyz`、Config Panel 健康检查 |

更多能力以实际安装版本与配置为准，建议部署后结合界面与 API 文档体验；
生产部署注意事项与 5000 并发路线详见 [`docs/scalability.md`](docs/scalability.md)。

> **启用多用户**：将 `basic_settings.yaml` 里 `AUTH_REQUIRED: true`，并配置强随机 `JWT_SECRET`；
> 启动时若用户表为空会自动种子一个管理员账号（密码输出到启动日志，生产务必立即改密）。
> 异步入库与语义缓存依赖 `REDIS_URL`，未配置时会自动回落到同步 / 不走缓存的行为，不会阻塞功能。

## 模型与推理框架

常见 **本地/私有化** 模型加载与推理方案包括：[Xinference](https://github.com/xorbitsai/inference)、[Ollama](https://github.com/ollama/ollama)、[LocalAI](https://github.com/mudler/LocalAI)、[FastChat](https://github.com/lm-sys/FastChat) 等；在线 API 可通过 [One API](https://github.com/songquanpeng/one-api) 等网关接入 OpenAI、Azure OpenAI、Anthropic、智谱、百川等兼容接口。

接入方式与各框架特性可参考其官方文档；察元侧主要在 `model_settings.yaml` 中配置平台与模型名称。

> [!Note]
> 使用 Xinference 加载本地已下载的权重时，可在启动 Xinference 后，于项目 `tools/model_loaders` 目录执行 `streamlit run xinference_manager.py`，按页面提示为模型指定本地路径。

## 快速上手

### 环境要求

- **Python**：3.8–3.11（推荐在独立虚拟环境中安装）
- **操作系统**：Windows、macOS、Linux 均有测试
- **硬件**：取决于所选模型与推理框架，支持 CPU / GPU / Apple Silicon 等常见环境

### 通过 pip 安装

```shell
pip install chayuan-server -U
```

> 建议使用官方 PyPI 或国内镜像源，以获取最新构建。

若需与 Xinference 搭配使用，可安装可选依赖：

```shell
pip install "chayuan-server[xinference]" -U
```

### 准备模型推理服务

请先启动您选用的模型服务（如 Xinference / Ollama 等），并加载对话模型、Embedding（及可选 Rerank）等，再在察元配置中填写对应 API 地址与模型名。

> [!WARNING]
> 为避免依赖冲突，建议将 **chayuan-server** 与 Xinference 等推理服务安装在 **不同的 Python 虚拟环境** 中。

### 初始化配置与数据目录

1.（可选）指定察元数据与配置根目录：

```shell
# Linux / macOS
export CHAYUAN_ROOT=/path/to/chayuan_data

# Windows（cmd）
set CHAYUAN_ROOT=D:\path\to\chayuan_data
```

未设置时，默认使用当前工作目录下的相关路径。

2. 执行初始化：

```shell
chayuan init
```

将创建数据目录、示例知识库占位，并生成默认 `yaml` 配置。

3. 按需编辑配置，例如：

- **`model_settings.yaml`**：对接上一步的推理服务，设置 `DEFAULT_LLM_MODEL`、`DEFAULT_EMBEDDING_MODEL` 及 `MODEL_PLATFORMS` 等。
- **`basic_settings.yaml`**：知识库存储路径、数据库路径、服务监听地址等。示例：

  ```yaml
  # 知识库根目录（请改为本机路径）
  KB_ROOT_PATH: /path/to/chayuan_data/data/knowledge_base

  # 元数据数据库（SQLite 示例）
  DB_ROOT_PATH: /path/to/chayuan_data/data/knowledge_base/info.db
  SQLALCHEMY_DATABASE_URI: sqlite:////path/to/chayuan_data/data/knowledge_base/info.db
  ```

- **`kb_settings.yaml`**：向量库类型等（可选）。

### 初始化知识库

在 **Embedding 模型已就绪** 且 `model_settings.yaml` 已正确配置的前提下执行：

```shell
chayuan kb -r
```

更多子命令见 `chayuan kb --help`。

### 启动服务

```shell
chayuan start -a
```

启动成功后可通过本机浏览器访问 Web 界面（具体端口以配置为准）。

![Web 界面示例](docs/img/langchain_chayuan_webui.png)

> [!WARNING]
> 默认监听地址 `DEFAULT_BIND_HOST` 常为 `127.0.0.1`，仅本机可访问。若需局域网或其它机器访问，请在 `basic_settings.yaml` 中将监听地址改为 `0.0.0.0`（请结合安全策略使用）。

#### 知识库初始化常见问题（Windows）

部分环境下 `from unstructured.partition.auto import partition` 可能长时间阻塞。可尝试调整 `python-magic-bin` 版本后重试，详见安装环境说明或社区反馈。

## 其它配置

- 数据库对话（Text2SQL）等高级能力，参见 [数据库对话配置说明](docs/install/README_text2sql.md)。
- 终端 CLI 对话客户端（**chachat**，类 Claude Code 体验）：`pip install 'chayuan-server[cli]'` 后直接 `chachat`，支持游客 / device-code 两种登录模式。详见 [docs/cli.md](docs/cli.md)。

## 源码与 Docker 部署

- **从源码开发/部署**：请参考 [开发指南](docs/contributing/README_dev.md)。
- **本地快速体验（社区镜像）**：见 [Docker 部署说明](docs/install/README_docker.md)，SQLite + FAISS 单机够用。
- **生产 / 多用户 / 5000 并发（推荐）**：见 [`docker/prod/README.md`](docker/prod/README.md)。
  该模板一键拉起 `postgres + redis + milvus + chayuan-api + chayuan-worker + chayuan-webui + chayuan-panel`，
  镜像自带 `chayuan init --profile prod` 生成 Postgres + Milvus + Redis 配置：

  ```bash
  cd docker/prod
  cp env.example .env && vi .env       # 务必改 JWT_SECRET / DB 密码
  docker compose up -d --build
  ```


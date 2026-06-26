# 察元 AI · Chayuan AI — Docker Image

> 中英双语部署文档 · Bilingual (中文 / English) deployment guide
> 适用于 Docker Hub / 阿里云 ACR / GHCR 等任意镜像仓库 · Works on Docker Hub / Aliyun ACR / GHCR / any registry

**察元（Chayuan）** 是一套面向办公场景的 AI 助手系统：WPS/Office 文档处理、个人/企业知识库（RAG）、结构化数据问答、外部向量源、多模态（文生图 / 文生视频 / 数字人 / 语音合成）与本地/云端模型网关，统一在一个 Web 界面里。
**Chayuan** is an office‑oriented AI assistant: document RAG, personal/enterprise knowledge bases, structured‑data Q&A, external vector sources, multimodal generation (text‑to‑image / text‑to‑video / digital‑human / TTS) and a local/cloud model gateway — all in one web UI.

这个镜像是 **一体化（all‑in‑one）镜像**：单个容器里同时跑后端（Python + 本地推理 sidecar）、nginx（反向代理）和前端 SPA。浏览器打开一个网址即可使用。
This image is **all‑in‑one**: a single container runs the backend (Python + local‑inference sidecar), nginx (reverse proxy) and the front‑end SPA. Open one URL in a browser and you are ready.

> ℹ️ 下文所有命令里的 `youruser/chayuan` 都是占位镜像名，请替换成你自己的仓库名（如 `dockerhubuser/chayuan` 或 `registry.cn-hangzhou.aliyuncs.com/yourns/chayuan`）。
> ℹ️ Replace `youruser/chayuan` in every command below with your own repository name (e.g. `dockerhubuser/chayuan` or `registry.cn-hangzhou.aliyuncs.com/yourns/chayuan`).

---

## 目录 · Table of Contents

1. [镜像标签 · Tags](#1-镜像标签--tags)
2. [快速开始（docker run）· Quick Start](#2-快速开始docker-run--quick-start)
3. [拉取镜像 · Pull](#3-拉取镜像--pull)
4. [端口 · Ports](#4-端口--ports)
5. [数据卷 · Volumes](#5-数据卷--volumes)
6. [提供模型 · Provide Models](#6-提供模型--provide-models)
7. [Docker Compose（推荐）· Docker Compose (recommended)](#7-docker-compose推荐--docker-compose-recommended)
8. [环境变量 · Environment Variables](#8-环境变量--environment-variables)
9. [登录 / 多用户 · Auth & Multi‑user](#9-登录--多用户--auth--multi-user)
10. [升级 · Upgrade](#10-升级--upgrade)
11. [常用命令 · Common Commands](#11-常用命令--common-commands)
12. [健康检查与排错 · Health & Troubleshooting](#12-健康检查与排错--health--troubleshooting)
13. [生产 / 公网安全清单 · Production Security](#13-生产--公网安全清单--production-security)
14. [发布到镜像仓库 · Push to a Registry](#14-发布到镜像仓库--push-to-a-registry)

---

## 1. 镜像标签 · Tags

| Tag | 说明 | Description |
|---|---|---|
| `latest` | 最新稳定一体化镜像 | Latest stable all‑in‑one image |
| `2.0.336`（示例） | 固定版本号，可复现部署 | Pinned version for reproducible deploys |
| `latest-slim` / `<版本>-slim` | 瘦身发布版（runtime 基于 `python:3.12-slim`，torch 为 CPU 版，体积 ~2–2.5 GB） | Slimmed release (slim runtime, CPU‑only torch, ~2–2.5 GB) |

**镜像内含 · Included in the image:** 后端源码、nginx + 前端 SPA、Linux x64 的 `llama-server` / `whisper-server` / ImageMagick 二进制、开源中文字幕字体（Noto Sans CJK SC）、片头/片尾等小资产。
Backend source, nginx + front‑end SPA, Linux‑x64 `llama-server` / `whisper-server` / ImageMagick binaries, an open‑source CJK subtitle font (Noto Sans CJK SC), and small built‑in assets.

**镜像不含 · NOT included:** 大模型权重（GGUF / whisper 等）。模型通过数据卷挂入，避免镜像臃肿、升级时重复下载几个 GB。见 [§6 提供模型](#6-提供模型--provide-models)。
Large model weights (GGUF / whisper, …). Models are mounted via a volume to keep the image small and avoid re‑downloading gigabytes on upgrade. See [§6](#6-提供模型--provide-models).

> 中文字幕字体已随镜像自带，视频/字幕生成开箱即用，**无需**额外安装字体。
> The CJK subtitle font ships inside the image — subtitle/video generation works out of the box, **no extra font setup**.

---

## 2. 快速开始（docker run）· Quick Start

最小一条命令即可拉起（匿名单机模式，所有访问共享一个 GUEST 账号）。
A single command brings it up (anonymous single‑machine mode; all access shares one GUEST account).

```bash
# 1) 建本地目录（数据 / 模型 / 配置 / 日志）
#    Create local dirs (data / models / config / logs)
mkdir -p chayuan/{data,models,config,logs}

# 2) 拉镜像并运行 / Pull & run
docker run -d \
  --name chayuan \
  --restart unless-stopped \
  -p 8080:80 \
  -p 62581:62581 \
  -p 8502:8502 \
  -v "$(pwd)/chayuan/data":/chayuan/data \
  -v "$(pwd)/chayuan/models":/chayuan/app/chayuan-server/vendor/bundled_models \
  -v "$(pwd)/chayuan/config":/chayuan/config \
  -v "$(pwd)/chayuan/logs":/chayuan/logs \
  youruser/chayuan:latest
```

启动后等待约 60–180 秒让 sidecar 就绪，然后浏览器打开 **http://localhost:8080**。
After start, wait ~60–180 s for the sidecar to become ready, then open **http://localhost:8080**.

> 首次打开 `:8080` 若后端尚无管理员，会弹**全屏「设置管理员」向导**（用户名 + 密码 + 实例标识）。设完即以管理员身份进入；匿名模式下其他访问仍按 GUEST 无需登录。
> On first open, if no admin exists yet, a full‑screen **“Set Admin” wizard** appears (username + password + instance id). After that you enter as admin; in anonymous mode other visitors still browse as GUEST without login.

> ⚠️ 不提供模型时聊天/检索会报「未就绪：no local candidate」。请先按 [§6](#6-提供模型--provide-models) 放入 GGUF，或在配置面板 `:8502` 配置云端模型。
> ⚠️ Without models, chat/retrieval reports “not ready: no local candidate”. Provide GGUF as in [§6](#6-提供模型--provide-models), or configure a cloud model in the panel at `:8502`.

---

## 3. 拉取镜像 · Pull

```bash
# 最新版 / latest
docker pull youruser/chayuan:latest

# 固定版本（推荐生产用）/ pinned version (recommended for production)
docker pull youruser/chayuan:2.0.336

# 瘦身发布版 / slim release
docker pull youruser/chayuan:latest-slim
```

国内网络可配置镜像加速器（Docker Hub mirror）或改用阿里云 ACR/私有仓库的地址前缀。
Behind a slow link, configure a Docker registry mirror, or use an Aliyun ACR / private‑registry prefix.

---

## 4. 端口 · Ports

| 容器端口 Container | 建议宿主映射 Host | 用途 | Purpose |
|---|---|---|---|
| `80` | `8080` | 前端 SPA + API 反代（浏览器主入口） | Front‑end SPA + API reverse proxy (main browser entry) |
| `62581` | `62581` | 后端 API 直连（WPS 加载项 / 桌面端 / 三方集成） | Direct backend API (WPS add‑in / desktop / 3rd‑party) |
| `8502` | `8502` | 后台配置面板（NiceGUI：模型 / yaml / 账号） | Admin config panel (NiceGUI: models / yaml / accounts) |

- 端口冲突时**只改宿主侧（冒号左边）**，例如 `-p 9090:80`。容器内端口写死，不可改。
  On a port clash, **only change the host side (left of the colon)**, e.g. `-p 9090:80`. Container‑internal ports are fixed.
- 公网部署**只暴露 `:8080`**，不要把 `:62581` / `:8502` 直接暴露到公网。见 [§13](#13-生产--公网安全清单--production-security)。
  For public deployments **expose only `:8080`**; never expose `:62581` / `:8502` publicly. See [§13](#13-生产--公网安全清单--production-security).

---

## 5. 数据卷 · Volumes

| 容器路径 Container path | 用途 | Purpose | 必需 Required |
|---|---|---|---|
| `/chayuan/data` | 知识库元数据 / sqlite / 上传文件 / 向量库 | KB metadata / sqlite / uploads / vector store | ✅ |
| `/chayuan/app/chayuan-server/vendor/bundled_models` | 本地 GGUF 模型（chat/embedding/rerank/asr/tts） | Local GGUF models | 用本地模型时 needed for local models |
| `/chayuan/config` | 可选：覆盖 `*.yaml` 配置（启动时 symlink 进数据目录） | Optional: override `*.yaml` (symlinked at boot) | ⬜ |
| `/chayuan/logs` | nginx + chayuan-server 运行日志 | Runtime logs | ⬜ |

所有可变数据都在 `/chayuan/data`，**整目录可备份 / 迁移**。删除容器不会丢数据（只要保留这些挂载目录）。
All mutable state lives under `/chayuan/data` — **back up / migrate the whole directory**. Removing the container loses nothing as long as the mounted dirs are kept.

---

## 6. 提供模型 · Provide Models

镜像不打大模型。把 GGUF 按下面结构放进**宿主机 models 目录**（即挂到 `/chayuan/app/chayuan-server/vendor/bundled_models` 的那个目录，上文用 `./chayuan/models`）。
The image ships no large weights. Put GGUF files into your **host models dir** (the one mounted to `/chayuan/app/chayuan-server/vendor/bundled_models`, i.e. `./chayuan/models` above) using this layout:

```text
models/
├── chat/
│   └── Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf
├── embedding/
│   └── bge-m3/bge-m3-Q8_0.gguf
├── rerank/
│   └── gpustack--bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q8_0.gguf
└── asr/                                  # 可选 optional（语音转写 speech-to-text）
    └── whisper.cpp/ggml-medium.bin
```

示例下载（ModelScope，国内可达；`embedding` 必须是 GGUF）：
Example downloads (ModelScope, reachable in CN; `embedding` must be GGUF):

```bash
cd chayuan/models

# Chat
mkdir -p chat/Qwen3-4B-Instruct-2507-GGUF
curl -L -o chat/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf \
  "https://www.modelscope.cn/api/v1/models/Qwen/Qwen3-4B-Instruct-2507-GGUF/repo?Revision=master&FilePath=Qwen3-4B-Instruct-2507-Q4_K_M.gguf"

# Embedding (bge-m3, 必须 GGUF / must be GGUF)
mkdir -p embedding/bge-m3
curl -L -o embedding/bge-m3/bge-m3-Q8_0.gguf \
  "https://www.modelscope.cn/api/v1/models/gpustack/bge-m3-GGUF/repo?Revision=master&FilePath=bge-m3-Q8_0.gguf"

# Rerank (只吃 GGUF / GGUF only)
mkdir -p rerank/gpustack--bge-reranker-v2-m3-GGUF
curl -L -o rerank/gpustack--bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q8_0.gguf \
  "https://www.modelscope.cn/api/v1/models/gpustack/bge-reranker-v2-m3-GGUF/repo?Revision=master&FilePath=bge-reranker-v2-m3-Q8_0.gguf"

# ASR (可选 / optional)
mkdir -p asr/whisper.cpp
curl -L -o asr/whisper.cpp/ggml-medium.bin \
  "https://www.modelscope.cn/api/v1/models/AI-ModelScope/whisper.cpp/repo?Revision=master&FilePath=ggml-medium.bin"
```

放好后重启容器，模型自动注册：
Restart the container afterwards; models are auto‑registered:

```bash
docker restart chayuan        # docker run 方式 / for docker run
# 或 / or
docker compose restart chayuan
```

> 也可以**完全不放本地模型**，只在配置面板 `:8502` 配置云端模型（OpenAI / 通义 / 智谱 / 火山豆包 等）的 API Key。
> You may skip local models entirely and configure cloud models (OpenAI / Qwen / Zhipu / Volcano, …) with API keys in the panel at `:8502`.

---

## 7. Docker Compose（推荐）· Docker Compose (recommended)

把下面保存为 `docker-compose.yml`，与之同级新建 `data/ models/ config/ logs/` 目录，然后 `docker compose up -d`。
Save the following as `docker-compose.yml`, create `data/ models/ config/ logs/` next to it, then `docker compose up -d`.

```yaml
# docker-compose.yml — 察元 AI 一体化（拉取式部署）/ all-in-one, pull-based
services:
  chayuan:
    image: youruser/chayuan:latest        # ← 换成你的镜像 / your image
    container_name: chayuan
    restart: unless-stopped
    ports:
      - "8080:80"          # 浏览器主入口 / main browser entry
      - "62581:62581"      # 后端 API 直连 / direct backend API
      - "8502:8502"        # 配置面板 / admin panel
    volumes:
      - ./data:/chayuan/data
      - ./models:/chayuan/app/chayuan-server/vendor/bundled_models
      - ./config:/chayuan/config
      - ./logs:/chayuan/logs
    environment:
      CHAYUAN_ROOT: /chayuan/data
      CHAYUAN_PROFILE: single-machine     # 单机内核 / single-machine kernel
      CHAYUAN_AUTH_REQUIRED: "false"      # 匿名 / anonymous（多用户见 §9）
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1/healthz"]
      interval: 30s
      timeout: 10s
      start_period: 180s
      retries: 5
```

```bash
docker compose up -d            # 启动 / start
docker compose logs -f chayuan  # 看日志 / follow logs
docker compose down             # 停止（数据保留）/ stop (data kept)
```

> 想用固定版本，把 `:latest` 换成 `:2.0.336`；想用瘦身版换成 `:latest-slim`。
> For a pinned version use `:2.0.336`; for the slim build use `:latest-slim`.

---

## 8. 环境变量 · Environment Variables

| 变量 Variable | 默认 Default | 说明 | Description |
|---|---|---|---|
| `CHAYUAN_ROOT` | `/chayuan/data` | 数据根目录（对应数据卷） | Data root (matches the data volume) |
| `CHAYUAN_PROFILE` | `single-machine` | 运行内核：`single-machine`=sqlite‑vec/内存队列；留空=网络形态（接外部 PG/Redis/Milvus） | Kernel profile; empty = networked (external PG/Redis/Milvus) |
| `CHAYUAN_AUTH_REQUIRED` | `false` | `false`=匿名；`true`=全接口要 JWT 登录 | `false`=anonymous; `true`=JWT required everywhere |
| `CHAYUAN_ALLOW_REGISTRATION` | `true` | 登录页是否有「注册」按钮 | Whether the login page shows “Register” |
| `JWT_SECRET` | （空 empty） | 多用户必填：JWT 签名密钥，留空进程随机生成（重启 Token 全失效）。生成：`openssl rand -hex 64` | Required for multi‑user; empty = random per boot. Generate with `openssl rand -hex 64` |
| `AUTH_DEFAULT_ADMIN_USERNAME` | `admin` | 首次启动若无用户，按此建管理员 | Bootstrap admin username if no users exist |
| `AUTH_DEFAULT_ADMIN_PASSWORD` | （空 empty） | 初始管理员密码；留空=首启随机生成并打到日志 | Initial admin password; empty = random, printed to logs |

> 提示：用 `.env` 文件管理上述变量更安全。compose 会自动读取同目录 `.env`。
> Tip: keep these in a `.env` file. Compose auto‑loads `.env` from the same directory.

---

## 9. 登录 / 多用户 · Auth & Multi‑user

**默认：单机匿名** — 所有访问按 GUEST 共享、无需登录。适合个人 / 内网 / 评估。
**Default: anonymous single‑machine** — everyone shares a GUEST account, no login. Good for personal / intranet / evaluation.

**切多用户 + 登录**（生产 / 团队）：设以下环境变量后重启容器。
**Switch to multi‑user + login** (production / team): set these env vars and restart.

```yaml
    environment:
      CHAYUAN_AUTH_REQUIRED: "true"
      CHAYUAN_ALLOW_REGISTRATION: "false"          # 内部部署关注册更安全 / safer to disable
      JWT_SECRET: "粘贴 openssl rand -hex 64 的结果 / paste output of: openssl rand -hex 64"
      AUTH_DEFAULT_ADMIN_USERNAME: "admin"
      AUTH_DEFAULT_ADMIN_PASSWORD: "改成你的初始密码 / your initial password"
```

启用后 · After enabling:
- `/chat/*`、`/knowledge_base/*`、`/api/*` 全部要 JWT。All these require a JWT.
- 没有管理员时前端首屏弹**「设置管理员」向导**；已有管理员则弹**登录框**。
  With no admin, the UI shows the **Set‑Admin wizard**; otherwise a **login box**.
- 关掉自助注册后，新用户只能由 admin 在配置面板 `:8502` 添加。
  With registration off, new users are added by the admin in the panel at `:8502`.

> 安全：初始化期间（尚无管理员时）**首个访问者即可设管理员**。请限制网络可达（仅内网 / 绑 `127.0.0.1` / 防火墙），避免被陌生人抢占。
> Security: while no admin exists, **the first visitor can claim admin**. Restrict network reachability (intranet only / bind `127.0.0.1` / firewall) during init.

---

## 10. 升级 · Upgrade

```bash
docker pull youruser/chayuan:latest      # 拉新镜像 / pull new image
docker compose up -d                     # 平滑替换容器，数据保留 / recreate, data kept
# docker run 方式 / for docker run:
#   docker rm -f chayuan && docker run -d ...（同 §2，数据卷不变）
```

数据都在挂载目录，升级不丢。建议生产用固定版本 tag、灰度后再切 `latest`。
Data lives in mounted dirs and survives upgrades. In production, pin a version tag and roll forward deliberately rather than tracking `latest`.

---

## 11. 常用命令 · Common Commands

```bash
docker logs -f chayuan                       # 看日志 / follow logs
docker exec -it chayuan bash                 # 进容器 / shell into container
docker exec chayuan curl -s http://127.0.0.1:62581/runtime/llama/status   # sidecar 状态 / sidecar status
docker restart chayuan                       # 改了模型/配置后重启 / restart after model/config change
docker stop chayuan                          # 停止（数据保留）/ stop (data kept)
docker rm -f chayuan                         # 删容器（挂载目录不动）/ remove container (mounts kept)

# Compose 等价命令 / Compose equivalents:
docker compose logs -f chayuan
docker compose exec chayuan bash
docker compose restart chayuan
docker compose down
```

---

## 12. 健康检查与排错 · Health & Troubleshooting

```bash
# 健康检查 / health checks
curl http://localhost:8080/healthz                      # nginx + 前端 / nginx + frontend
curl http://localhost:62581/runtime/llama/status        # 后端 sidecar / backend sidecar

# 启动日志 / boot logs
docker logs --tail=200 chayuan
```

| 现象 Symptom | 可能原因与处理 Likely cause & fix |
|---|---|
| 聊天/检索「未就绪：no local candidate」| 没放本地模型。按 [§6](#6-提供模型--provide-models) 放 GGUF 并重启，或在 `:8502` 配云端模型。 No local model — add GGUF (§6) & restart, or configure a cloud model at `:8502`. |
| 浏览器首屏白屏 / `reading 'invoke'` | 多半挂载了错误前端产物或反代异常。用纯净镜像、别挂主机 `apps/web/dist`。 Wrong front‑end mounted/proxy — use the clean image, don’t mount host `apps/web/dist`. |
| 启动后立刻 60–180s 无响应 | 正常：sidecar 初始化 + 加载模型。等 `start_period` 过后再判断。 Normal warm‑up; wait out `start_period`. |
| 端口被占 | 改宿主映射端口（`-p 9090:80`），容器内端口固定。 Change host port mapping; container ports are fixed. |
| 中文字幕渲染成方框 | 本镜像已自带 CJK 字体；若你自定义挂载覆盖了字体目录，请保留一个 CJK 字体。 Image bundles a CJK font; keep one if you override the font dir. |

---

## 13. 生产 / 公网安全清单 · Production Security

1. **启用多用户**（`CHAYUAN_AUTH_REQUIRED=true`），`JWT_SECRET` 不能留空。
   Enable multi‑user; never leave `JWT_SECRET` empty.
2. **只对外暴露 `:8080`**，`:62581` / `:8502` 仅走内网或绑 `127.0.0.1`。
   Expose **only `:8080`**; keep `:62581` / `:8502` internal or bound to `127.0.0.1`.
3. 在 `:8080` 前置 **TLS**（Caddy / Nginx / Cloudflare / 你的 ingress）。
   Terminate **TLS** in front of `:8080`.
4. 关闭自助注册（`CHAYUAN_ALLOW_REGISTRATION=false`）。
   Disable self‑registration.
5. 定期备份 `data/` 与 `models/`。
   Back up `data/` and `models/` regularly.

---

## 14. 发布到镜像仓库 · Push to a Registry

把本地构建好的镜像 tag 成你的仓库名再 push（README 文件本身可作为仓库 Overview 直接粘贴）。
Tag your locally built image to your repo name and push (this file can be pasted as the repository Overview).

```bash
# Docker Hub
docker login
docker tag chayuan:latest youruser/chayuan:latest
docker tag chayuan:latest youruser/chayuan:2.0.336
docker push youruser/chayuan:latest
docker push youruser/chayuan:2.0.336

# 阿里云 ACR / 私有仓库 / private registry
docker login registry.cn-hangzhou.aliyuncs.com
docker tag chayuan:latest registry.cn-hangzhou.aliyuncs.com/yourns/chayuan:2.0.336
docker push registry.cn-hangzhou.aliyuncs.com/yourns/chayuan:2.0.336
```

多架构 / 瘦身发布说明见仓库内 `docker/README.md` 与 `docker/build-release.sh`。
For multi‑arch / slim‑release builds, see `docker/README.md` and `docker/build-release.sh` in the source repo.

---

<p align="center">察元 AI · Chayuan — 一个网址，端到端的办公 AI · One URL, end‑to‑end office AI</p>

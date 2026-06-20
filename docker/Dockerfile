# syntax=docker/dockerfile:1.6
# ====================================================================
# 察元 AI 单机版 — Docker image (前后端一体)
# ====================================================================
# 单 image 同时跑:
#   - chayuan-server (Python FastAPI + chat/embedding/rerank/asr sidecar +
#     config panel)        ── 内部端口 62581 / 62582-5 / 8502
#   - nginx                ── 暴露端口 80,serve 前端 SPA + 反代 API
#
# 浏览器访问:http://<host>/  → 直接进前端
# API 自身仍可访问 http://<host>:62581 (compose 选择是否暴露)
#
# bundled_models 不打进 image,通过 docker volume 挂入。
#
# Build context **必须**是 repo 根 (chayuan-desktop/):
#   docker build -f docker/Dockerfile -t chayuan-server:1.0.0 .
#
# 或推荐 compose:
#   cd docker && docker compose up -d --build
# ====================================================================


# ─────────────────────────────────────────────────────────────────
# Stage 1: build 前端 (Vite -> apps/web/dist)
# ⚠ 必须 build apps/web(浏览器 SPA,平台层 = @chayuan/platform-web),不是
# apps/desktop(Tauri 壳,平台层 = @chayuan/platform-tauri)。desktop 入口在
# main.tsx 顶层 setPlatform(createTauriPlatform()),开机即调 Tauri ``invoke``;
# 在普通浏览器(nginx serve)里 window.__TAURI_INTERNALS__ 不存在,首屏直接抛
# "Cannot read properties of undefined (reading 'invoke')" 整页白屏。
# 前端 build 时设 VITE_API_BASE=""  让 fetch 走相对路径,
# 浏览器同源 (nginx 反代) -> 后端,无 CORS。
# ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS web-builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /chayuan-client
COPY chayuan-client/pnpm-workspace.yaml chayuan-client/package.json chayuan-client/pnpm-lock.yaml ./
# tsconfig.base.json 被 apps/desktop 及各 package 的 tsconfig extends,vite 给
# esbuild 读 tsconfig 时要解析它;缺它 build 直接失败,必须拷进工作区根。
COPY chayuan-client/tsconfig.base.json ./

# 拷所有 package.json 让 pnpm install 利用 layer cache
COPY chayuan-client/packages ./packages
COPY chayuan-client/apps    ./apps
# e2e-desktop 是 pnpm-workspace.yaml 列的 workspace 成员,缺它 --frozen-lockfile
# 会因 importer 缺失而失败;只在 builder 层,最终镜像只取 apps/desktop/dist,无体积代价。
COPY chayuan-client/e2e-desktop ./e2e-desktop

# 装依赖(--frozen-lockfile = CI 严格模式)
# Tauri Rust 在 docker 构建里不需要,跳过 native bindings
ENV TAURI_SKIP_DEVSERVER_CHECK=1
RUN pnpm install --frozen-lockfile --prefer-offline || pnpm install

# 前端 build:VITE_API_BASE 空 + VITE_THIN_CLIENT 0,产物用相对路径请求 API
ENV VITE_API_BASE="" \
    VITE_THIN_CLIENT="0"
RUN pnpm -F web build:vite


# ─────────────────────────────────────────────────────────────────
# Stage 2: 后端 + nginx 运行时
# ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_CACHE_DIR=/tmp/poetry-cache \
    DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# 系统依赖
#   build-essential   : 个别 wheel 落不到二进制要现编
#   libgomp1          : faiss / numpy OpenMP runtime
#   libstdc++6 libgcc-s1 : llama-server / whisper-server sidecar 二进制 link
#   ffmpeg libsndfile1 : ASR 音频解码
#   libmagic1         : python-magic (unstructured 用)
#   nginx-light       : 前端 + API 反代
#   curl git ca-certs : 运行时下模型 / KB ingest / healthcheck
#   tini              : PID 1 信号转发,docker stop 干净退出 nginx + chayuan
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libgomp1 libstdc++6 libgcc-s1 \
        ffmpeg libsndfile1 \
        libmagic1 \
        nginx-light \
        curl git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* /var/log/nginx/*

RUN pip install --no-cache-dir poetry==2.2.0

WORKDIR /chayuan/app

# ── 1. 依赖层 ─────────────────────────────────────────────────────
COPY chayuan-server/libs/chayuan-server/pyproject.toml ./chayuan-server/libs/chayuan-server/
COPY chayuan-server/libs/chayuan-server/poetry.lock* ./chayuan-server/libs/chayuan-server/

WORKDIR /chayuan/app/chayuan-server/libs/chayuan-server
# BuildKit 持久缓存挂载:已下载的 wheel 跨 build 复用(放在镜像层外,不进镜像、不增体积)。
# 这样即便每次提交 bump 了 pyproject 版本号、导致上面 COPY 层缓存失效、本层重跑,
# 也只是从本地缓存「复制上一个版本的基础环境」再 link 进 site-packages —— 不再联网重下,
# 资源/时间省一大截。故意不再 --no-cache、不再 rm 缓存(那正是要保留的东西)。
# --no-root:运行时用 `python -m chayuan`(见 entrypoint)+ PYTHONPATH 跑源码,
#           无需把 root 包装进 site-packages;原先源码 COPY 之后那次不带 --no-root 的
#           install 会随每次改代码重跑、纯浪费,已删。
RUN --mount=type=cache,target=/tmp/poetry-cache poetry install --only main --no-root

# ── 2. 后端源码 ───────────────────────────────────────────────────
WORKDIR /chayuan/app
COPY chayuan-server/libs/chayuan-server/chayuan ./chayuan-server/libs/chayuan-server/chayuan
COPY chayuan-server/libs/chayuan-server/langchain_chayuan ./chayuan-server/libs/chayuan-server/langchain_chayuan

# ── 3. Sidecar 二进制 (.dockerignore 已排除非 linux 平台) ──────────
WORKDIR /chayuan/app
COPY chayuan-server/vendor/services ./chayuan-server/vendor/services
RUN chmod +x \
        /chayuan/app/chayuan-server/vendor/services/llama-server/linux-x64/llama-server \
        /chayuan/app/chayuan-server/vendor/services/whisper-server/linux-x64/whisper-server \
        /chayuan/app/chayuan-server/vendor/services/imagemagick/linux-x64/magick \
    2>/dev/null || true

# ── 3b. video_generation 模块 bundled 资产 (M3) ────────────────────
#   字体 / BGM / 内置素材 — 全部按需 COPY,不存在的目录由 Dockerfile 的
#   RUN mkdir 兜底(让 binaries.py 启动探测时不会因目录缺失抛 Python 错)。
#   实际媒体二进制 / 字体文件由用户在 build 前用
#   scripts/seed-bundled-assets.py 拉齐(或手工放进 vendor/bundled_*)。
COPY chayuan-server/vendor/bundled_fonts ./chayuan-server/vendor/bundled_fonts
COPY chayuan-server/vendor/bundled_bgm ./chayuan-server/vendor/bundled_bgm
COPY chayuan-server/vendor/bundled_video_clips ./chayuan-server/vendor/bundled_video_clips

# ── 4. 拷前端 dist (来自 stage 1) ──────────────────────────────────
COPY --from=web-builder /chayuan-client/apps/web/dist /chayuan/web

# ── 5. nginx 配置 + entrypoint ────────────────────────────────────
COPY docker/nginx.conf      /etc/nginx/nginx.conf
COPY docker/entrypoint.sh   /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# ── 6. volume 占位 ────────────────────────────────────────────────
RUN mkdir -p /chayuan/app/chayuan-server/vendor/bundled_models \
             /chayuan/data \
             /chayuan/logs

# 运行时环境
ENV CHAYUAN_ROOT=/chayuan/data \
    CHAYUAN_PROFILE=single-machine \
    CHAYUAN_AUTH=anonymous \
    CHAYUAN_REDIS=disabled \
    CHAYUAN_QUEUE=inproc \
    CHAYUAN_VECTOR_STORE=sqlite-vec \
    CHAYUAN_AUTO_INSTALL_DEPS=false \
    CHAYUAN_ROOT_IGNORE_STATE=1 \
    CHAYUAN_VENDOR_PLATFORM=linux-x64 \
    PYTHONPATH=/chayuan/app/chayuan-server/libs/chayuan-server

EXPOSE 80 62581 8502

# nginx 反代后,健康检查打 nginx 80 即等价后端 ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
    CMD curl -fsS http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["start", "-a", "--single-machine"]

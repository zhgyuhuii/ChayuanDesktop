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
# FROM 指令里要用的 build-arg 必须在【第一个 FROM 之前】声明为全局 ARG,
# 否则在 multi-stage 里它只属于某个 stage,后面 `FROM ${BASE_IMAGE}` 取不到 → 空。
ARG BASE_IMAGE=chayuan-base:latest

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
# 系统依赖 + Python 依赖全部来自基础环境镜像(docker/Dockerfile.base,由 docker/build.sh
# 按 poetry.lock 哈希自动构建/复用)。这里**不再** apt / poetry install:改业务代码 /
# version bump 重建主镜像时,只跑下面的 COPY 层 → 零依赖拉取。依赖变了(poetry.lock 改)
# 才会重建 base(build.sh 自动判定,或 ./build.sh --rebuild-base)。
FROM ${BASE_IMAGE} AS runtime

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

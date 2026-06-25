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
ARG WEB_BASE_IMAGE=chayuan-web-base:latest

# 前端依赖来自 web 基础镜像(docker/Dockerfile.webbase,build.sh 按 pnpm-lock 哈希
# 构建/复用):pnpm fetch 已把所有依赖拉进 store。这里只 COPY 源码 + 离线 install,
# 改业务代码重建时零联网。依赖变了(pnpm-lock 改)才重建 web base。
FROM ${WEB_BASE_IMAGE} AS web-builder

ENV CI=1
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
# images/ 在工作区根(packages/app/src/lib/brandAssets.ts 用 new URL('../../../../images/...',
# import.meta.url) 引用 logo + 关注/收款二维码)。缺它 Vite 静默保留运行时 URL → 浏览器 404,
# 二维码/logo 不显示。必须拷进构建上下文,Vite 才能打成 /assets/ 哈希资源。
COPY chayuan-client/images ./images

# 装依赖:web base 的 pnpm fetch 已预取整个 store,这里 --offline 离线链接,
# 正常路径**零联网**;仅当 store 缺失(极少)才回退联网 install 兜底。
# Tauri Rust 在 docker 构建里不需要,跳过 native bindings
ENV TAURI_SKIP_DEVSERVER_CHECK=1
RUN pnpm install --offline --frozen-lockfile || pnpm install

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

# ── 对象存储 minio 客户端:已在基础镜像(Dockerfile.base)预装 ──────────────────
# 这里仅做兜底:base 已含 minio → import 通过、【零拉取】(改业务代码重建主镜像不再下载
# minio / argon2-cffi / pycryptodome);仅当 base 偏旧不含 minio 时才回退联网补装。
# 让 base 真正带上 minio:跑一次 `./build.sh --rebuild-base`。
# 国内默认源慢/不可达时:--build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_INDEX_URL=
RUN python -c "import minio" 2>/dev/null \
    || python -m pip install --no-cache-dir ${PIP_INDEX_URL:+-i "$PIP_INDEX_URL"} "minio>=7.2,<8.0" \
    || echo "[build] minio 预装失败(多半是网络),不阻断构建;运行时首次用对象存储会自动补装(ensure_pkg)"

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
# 修复软链:vendor/services 里的 .so 别名(libwhisper.so / libwhisper.so.1 等)在 git
# 里是 symlink(mode 120000)。若构建上下文以 core.symlinks=false 方式 checkout(Windows
# 克隆 / zip 传输丢失软链),git 会把软链还原成「内容=目标路径文本」的 19 字节小文件,
# COPY 原样进镜像,运行时 ld.so 把 19 字节当 ELF 头读 -> "file too short"。这里把这类
# 伪软链恢复成真正的 symlink,使镜像与 checkout 方式无关。
RUN find /chayuan/app/chayuan-server/vendor/services -path '*/linux-x64/*' -type f ! -type l | while IFS= read -r f; do \
        [ "$(stat -c%s "$f")" -le 256 ] || continue; \
        [ "$(head -c4 "$f" | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] && continue; \
        tgt=$(cat "$f"); d=$(dirname "$f"); \
        [ -n "$tgt" ] && [ -e "$d/$tgt" ] || continue; \
        rm -f "$f" && ln -s "$tgt" "$f" && echo "repaired symlink: $f -> $tgt"; \
    done

# ── 3b. video_generation 模块 bundled 资产 (M3) ────────────────────
#   字体 / BGM / 内置素材 — 全部按需 COPY,不存在的目录由 Dockerfile 的
#   RUN mkdir 兜底(让 binaries.py 启动探测时不会因目录缺失抛 Python 错)。
#   实际媒体二进制 / 字体文件由用户在 build 前用
#   scripts/seed-bundled-assets.py 拉齐(或手工放进 vendor/bundled_*)。
COPY chayuan-server/vendor/bundled_fonts ./chayuan-server/vendor/bundled_fonts
COPY chayuan-server/vendor/bundled_bgm ./chayuan-server/vendor/bundled_bgm
COPY chayuan-server/vendor/bundled_video_clips ./chayuan-server/vendor/bundled_video_clips
# 片尾 video_end.mp4(非会员视频自动拼接);单机版走 PyInstaller datas,docker 需显式 COPY 命中 _outro_source 源码树探测
COPY chayuan-server/video ./chayuan-server/video

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

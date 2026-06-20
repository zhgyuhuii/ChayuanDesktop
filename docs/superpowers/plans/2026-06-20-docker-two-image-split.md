# Docker 两镜像拆分部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 docker 单镜像(server+nginx+前端全挤一个,后端崩则前端一起死)拆成 chayuan-server / chayuan-client 两个解耦镜像,与现有单镜像共存。

**Architecture:** client 镜像(nginx:alpine + React SPA, 轻)用 docker 内嵌 DNS + 变量 proxy_pass 按容器名 `chayuan-server:62581` 反代后端;浏览器走同源相对路径(不能解析容器名)。server 镜像(FastAPI + sidecar, 重)不含 nginx/前端,独立运行。

**Tech Stack:** Docker(multi-stage), nginx, pnpm(`pnpm -F web build:vite`), Python/poetry(后端复用现有层), docker compose v2。

设计文档:`docs/superpowers/specs/2026-06-20-docker-two-image-split-design.md`

**全局约束:**
- 所有文件在 `/work/chayuan-desktop/docker/` 下新增,**不改**现有 `Dockerfile` / `entrypoint.sh` / `nginx.conf` / `docker-compose.yaml`(单镜像保留)。
- 仓库 root 所有,提交用 `sudo git`,只 stage 新增文件,分支 main→origin/main。
- 构建机磁盘 98% 满 + 无独立测试 docker daemon → **本计划的 build/up/curl 验证由用户在能跑 docker、有磁盘空间的机器执行**;作者机只做静态 `docker compose config` 校验。
- 纯 infra 文件,不 bump 版本号(版本号只跟程序代码走)。

---

### Task 1: server 镜像 entrypoint(无 nginx)

**Files:**
- Create: `/work/chayuan-desktop/docker/entrypoint.server.sh`

- [ ] **Step 1: 写 entrypoint.server.sh(照搬现 entrypoint.sh 但删掉 nginx 段)**

```bash
sudo tee /work/chayuan-desktop/docker/entrypoint.server.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
# entrypoint(split 部署 server 镜像):只跑 chayuan-server(Python),不起 nginx。
# tini 在 PID 1,本脚本 PID 2;chayuan 退出 -> 脚本退出 -> tini 收容器(前端在另一个容器,不受影响)。
set -e

echo "[entrypoint.server] booting chayuan-server (split, no nginx)"
echo "[entrypoint.server] CHAYUAN_ROOT         = ${CHAYUAN_ROOT}"
echo "[entrypoint.server] CHAYUAN_PROFILE      = ${CHAYUAN_PROFILE}"
echo "[entrypoint.server] CHAYUAN_VECTOR_STORE = ${CHAYUAN_VECTOR_STORE}"

mkdir -p "${CHAYUAN_ROOT}" \
         "${CHAYUAN_ROOT}/data" \
         "${CHAYUAN_ROOT}/data/knowledge_base" \
         "${CHAYUAN_ROOT}/data/files" \
         /chayuan/logs \
         /chayuan/app/chayuan-server/vendor/bundled_models

if [ -d /chayuan/config ] && [ "$(ls -A /chayuan/config 2>/dev/null)" ]; then
    echo "[entrypoint.server] /chayuan/config 有内容,符号链接到 ${CHAYUAN_ROOT}/"
    for f in /chayuan/config/*.yaml; do
        [ -f "$f" ] || continue
        ln -sf "$f" "${CHAYUAN_ROOT}/$(basename "$f")"
    done
fi

cd /chayuan/app/chayuan-server/libs/chayuan-server
echo "[entrypoint.server] starting chayuan-server: chayuan $*"
exec python -m chayuan "$@"
EOF
sudo chmod +x /work/chayuan-desktop/docker/entrypoint.server.sh
```

- [ ] **Step 2: 校验 bash 语法**

Run: `sudo bash -n /work/chayuan-desktop/docker/entrypoint.server.sh && echo OK`
Expected: `OK`

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo git add -- docker/entrypoint.server.sh
sudo git commit -m "feat(docker): split server entrypoint(无 nginx,只跑 chayuan-server)"
```

---

### Task 2: Dockerfile.server(后端单镜像)

**Files:**
- Create: `/work/chayuan-desktop/docker/Dockerfile.server`

- [ ] **Step 1: 写 Dockerfile.server(复用现 Dockerfile 后端层,删 web-builder + nginx + 前端 COPY)**

```bash
sudo tee /work/chayuan-desktop/docker/Dockerfile.server > /dev/null <<'EOF'
# syntax=docker/dockerfile:1.6
# ====================================================================
# chayuan-server 后端单镜像(split 部署用,无 nginx / 无前端)
#   docker build -f docker/Dockerfile.server -t chayuan-server:split .   (context=repo 根)
# ====================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_CACHE_DIR=/tmp/poetry-cache \
    DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libgomp1 libstdc++6 libgcc-s1 \
        ffmpeg libsndfile1 \
        libmagic1 \
        curl git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==2.4.1

WORKDIR /chayuan/app
COPY chayuan-server/libs/chayuan-server/pyproject.toml ./chayuan-server/libs/chayuan-server/
COPY chayuan-server/libs/chayuan-server/poetry.lock* ./chayuan-server/libs/chayuan-server/
WORKDIR /chayuan/app/chayuan-server/libs/chayuan-server
RUN --mount=type=cache,target=/tmp/poetry-cache \
    poetry install --only main --no-root \
    || (echo "[build] poetry.lock 失配,镜像内重锁..." && poetry lock && poetry install --only main --no-root)

WORKDIR /chayuan/app
COPY chayuan-server/libs/chayuan-server/chayuan ./chayuan-server/libs/chayuan-server/chayuan
COPY chayuan-server/libs/chayuan-server/langchain_chayuan ./chayuan-server/libs/chayuan-server/langchain_chayuan
COPY chayuan-server/vendor/services ./chayuan-server/vendor/services
RUN chmod +x \
        /chayuan/app/chayuan-server/vendor/services/llama-server/linux-x64/llama-server \
        /chayuan/app/chayuan-server/vendor/services/whisper-server/linux-x64/whisper-server \
        /chayuan/app/chayuan-server/vendor/services/imagemagick/linux-x64/magick \
    2>/dev/null || true
COPY chayuan-server/vendor/bundled_fonts ./chayuan-server/vendor/bundled_fonts
COPY chayuan-server/vendor/bundled_bgm ./chayuan-server/vendor/bundled_bgm
COPY chayuan-server/vendor/bundled_video_clips ./chayuan-server/vendor/bundled_video_clips

COPY docker/entrypoint.server.sh /usr/local/bin/entrypoint.server.sh
RUN chmod +x /usr/local/bin/entrypoint.server.sh

RUN mkdir -p /chayuan/app/chayuan-server/vendor/bundled_models /chayuan/data /chayuan/logs

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

EXPOSE 62581

# 直打后端 liveness(health_routes.py 的 /healthz);深度探活是 /readyz
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
    CMD curl -fsS http://127.0.0.1:62581/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.server.sh"]
CMD ["start", "-a", "--single-machine"]
EOF
```

- [ ] **Step 2: 确认 .dockerignore 不排除后端源码(现有 .dockerignore 已为单镜像放行 chayuan-server/)**

Run: `cd /work/chayuan-desktop && grep -nE 'chayuan-server' docker/../.dockerignore 2>/dev/null | head; echo "---"; sudo test -f chayuan-server/libs/chayuan-server/chayuan/__main__.py && echo "backend __main__ 存在"`
Expected: 打印 .dockerignore 中 chayuan-server 相关行(应是放行而非整目录排除) + `backend __main__ 存在`

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo git add -- docker/Dockerfile.server
sudo git commit -m "feat(docker): Dockerfile.server 后端单镜像(无 nginx/前端,split 用)"
```

---

### Task 3: nginx.split.conf(client 反代,按容器名)

**Files:**
- Create: `/work/chayuan-desktop/docker/nginx.split.conf`

- [ ] **Step 1: 写 nginx.split.conf(放进 nginx:alpine 的 conf.d/,故为 server 块,不含 http{})**

```bash
sudo tee /work/chayuan-desktop/docker/nginx.split.conf > /dev/null <<'EOF'
# chayuan-client (split 部署) — serve React SPA + 按容器名反代 chayuan-server
# 本文件放进 nginx:alpine 的 /etc/nginx/conf.d/ (基础镜像 nginx.conf 的 http{} 已 include 它),
# 故这里只写 server{},不写 http{}。
server {
    listen      80 default_server;
    server_name _;

    root  /usr/share/nginx/html;
    index index.html;

    access_log off;
    client_max_body_size 1024m;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               application/xml+rss application/atom+xml image/svg+xml;
    gzip_min_length 1024;

    # docker 内嵌 DNS(127.0.0.11):按容器名每请求重解析,chayuan-server 重启换 IP 不挂。
    resolver 127.0.0.11 valid=10s ipv6=off;

    # client 自身存活探针(与后端 /healthz 无关)
    location = /healthz {
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    # 后端 API 路径反代到 chayuan-server:62581(容器名,docker 网络内解析)。
    # 路径清单与单镜像 nginx.conf 保持一致;前端新增路由组要两处同步。
    location ~ ^/(api|v1|chat|knowledge_base|knowledge_universe|knowledge_source|admin|runtime|model_registry|tools|tool|prompts|temp|file|files|media|img|status|live|ready|metrics|conversation|user|users|auth|kb-query|sse|sidecar|install_jobs|annotation|llm|llm_model|ai_platform|local_runtime|provider|capability|home)(/|$) {
        # 用变量 + resolver 触发每请求重解析;静态 upstream 只启动解析一次(server 没起就 502)。
        set $upstream http://chayuan-server:62581;
        proxy_pass $upstream;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 长连接 + 禁 buffer(对齐单镜像 nginx.conf)
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        chunked_transfer_encoding on;
    }

    # 前端 SPA:文件存在直发,否则 fallback index.html(React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

- [ ] **Step 2: 确认 ASCII/无明显语法问题(nginx -t 需镜像内做,放到 Task 6)**

Run: `sudo grep -c 'proxy_pass $upstream;' /work/chayuan-desktop/docker/nginx.split.conf`
Expected: `1`

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo git add -- docker/nginx.split.conf
sudo git commit -m "feat(docker): nginx.split.conf 按容器名反代后端(resolver+变量 proxy_pass)"
```

---

### Task 4: Dockerfile.client(nginx + 前端,无 Python)

**Files:**
- Create: `/work/chayuan-desktop/docker/Dockerfile.client`

- [ ] **Step 1: 写 Dockerfile.client**

```bash
sudo tee /work/chayuan-desktop/docker/Dockerfile.client > /dev/null <<'EOF'
# syntax=docker/dockerfile:1.6
# ====================================================================
# chayuan-client 前端单镜像(split 部署用):nginx + React SPA(apps/web),无 Python。
#   docker build -f docker/Dockerfile.client -t chayuan-client:split .   (context=repo 根)
# ⚠ 必须 build apps/web(platform-web),不是 apps/desktop(Tauri 壳,开机调 invoke 会白屏)。
# ====================================================================
FROM node:20-bookworm-slim AS web-builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    TAURI_SKIP_DEVSERVER_CHECK=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /chayuan-client
COPY chayuan-client/pnpm-workspace.yaml chayuan-client/package.json chayuan-client/pnpm-lock.yaml ./
COPY chayuan-client/tsconfig.base.json ./
COPY chayuan-client/packages ./packages
COPY chayuan-client/apps    ./apps
COPY chayuan-client/e2e-desktop ./e2e-desktop
RUN pnpm install --frozen-lockfile --prefer-offline || pnpm install

# 相对路径请求(VITE_API_BASE 空)→ 浏览器同源打 client nginx → 反代 server。
ENV VITE_API_BASE="" \
    VITE_THIN_CLIENT="0"
RUN pnpm -F web build:vite


FROM nginx:alpine AS runtime
# 去掉基础镜像默认 server,换成我们的
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.split.conf /etc/nginx/conf.d/chayuan.conf
COPY --from=web-builder /chayuan-client/apps/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
EOF
```

- [ ] **Step 2: 确认 apps/web build:vite 脚本存在(否则 build 步骤会失败)**

Run: `cd /work/chayuan-desktop && node -e "const s=require('./chayuan-client/apps/web/package.json').scripts; if(!s['build:vite']) throw new Error('缺 build:vite'); console.log('build:vite OK ->', s['build:vite'])"`
Expected: `build:vite OK -> vite build`

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo git add -- docker/Dockerfile.client
sudo git commit -m "feat(docker): Dockerfile.client nginx+apps/web SPA(无 Python)"
```

---

### Task 5: docker-compose.split.yaml(两 service 编排)

**Files:**
- Create: `/work/chayuan-desktop/docker/docker-compose.split.yaml`

- [ ] **Step 1: 写 docker-compose.split.yaml**

```bash
sudo tee /work/chayuan-desktop/docker/docker-compose.split.yaml > /dev/null <<'EOF'
# 察元 AI — 两镜像拆分部署(server 后端 / client 前端 解耦)
# 启动:cd docker && docker compose -f docker-compose.split.yaml up -d --build
# 浏览器:http://<host>:8080/
# ⚠ container_name=chayuan-server 必须与 nginx.split.conf 的反代目标一致(容器名 DNS)。
# ⚠ 与单镜像 docker-compose.yaml 的 container_name 同名,两套不要同时起。
name: chayuan-split

services:
  chayuan-server:
    build:
      context: ..
      dockerfile: docker/Dockerfile.server
    image: chayuan-server:split
    container_name: chayuan-server
    restart: unless-stopped
    # 默认仅 docker 网络内可达(client nginx 反代);需要 WPS/Tauri/三方 OpenAI SDK
    # 直连后端时,放开下面端口映射。
    # ports:
    #   - "62581:62581"
    volumes:
      - ./data:/chayuan/data
      - ./bundled_models:/chayuan/app/chayuan-server/vendor/bundled_models
      - ./config:/chayuan/config
      - ./logs:/chayuan/logs
    environment:
      CHAYUAN_ROOT: /chayuan/data
      CHAYUAN_PROFILE: single-machine
      CHAYUAN_REDIS: disabled
      CHAYUAN_QUEUE: inproc
      CHAYUAN_VECTOR_STORE: sqlite-vec
      CHAYUAN_AUTO_INSTALL_DEPS: "false"
      CHAYUAN_ROOT_IGNORE_STATE: "1"
      CHAYUAN_VENDOR_PLATFORM: linux-x64
      CHAYUAN_PRELOAD_ON_START: "false"
      CHAYUAN_AUTH_REQUIRED: "false"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:62581/healthz"]
      interval: 30s
      timeout: 10s
      start_period: 180s
      retries: 5

  chayuan-client:
    build:
      context: ..
      dockerfile: docker/Dockerfile.client
    image: chayuan-client:split
    container_name: chayuan-client
    restart: unless-stopped
    ports:
      - "8080:80"      # 浏览器主入口
    depends_on:
      chayuan-server:
        condition: service_started
EOF
```

- [ ] **Step 2: 静态校验 compose 可解析(作者机即可跑,不需要 build)**

Run: `cd /work/chayuan-desktop/docker && sudo docker compose -f docker-compose.split.yaml config >/dev/null && echo "compose OK"`
Expected: `compose OK`(若该机无 docker 权限/daemon,跳到执行机做)

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop
sudo git add -- docker/docker-compose.split.yaml
sudo git commit -m "feat(docker): docker-compose.split.yaml 两镜像编排(client 8080 + server 内网)"
```

---

### Task 6: 端到端验证(执行机:有 docker + 磁盘空间)

**Files:** 无(仅运行验证)

- [ ] **Step 1: 腾盘确认(server 镜像带 torch/sidecar,需数 GB)**

Run: `df -h / | tail -1`
Expected: Avail 至少 ~8GB;不足先清(`docker system prune -af` 等)。

- [ ] **Step 2: 构建并启动两镜像**

Run: `cd /work/chayuan-desktop/docker && sudo docker compose -f docker-compose.split.yaml up -d --build`
Expected: 两 service 构建成功并 `Started`;`sudo docker compose -f docker-compose.split.yaml ps` 显示 chayuan-server / chayuan-client 都在。

- [ ] **Step 3: client 自身存活**

Run: `curl -fsS http://localhost:8080/healthz`
Expected: `ok`

- [ ] **Step 4: 前端页面打开 + 无 invoke 白屏**

Run: `curl -fsS http://localhost:8080/ | grep -o '<div id="[a-z]*">' | head; curl -s http://localhost:8080/ | grep -c '__TAURI_INTERNALS__' || true`
Expected: 拿到 index.html(有挂载点 div);`__TAURI_INTERNALS__` 计数为 0(确认是 web 产物不是 desktop)。浏览器开 `http://<host>:8080/` 页面正常。

- [ ] **Step 5: API 反代通(等 server healthy 后)**

Run: `curl -fsS http://localhost:8080/healthz; echo; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/v1/models`
Expected: client healthz=ok;`/v1/models` 返回非 502(200 或 401,取决于鉴权)— 证明反代打通到后端。

- [ ] **Step 6: 解耦验证(核心)— 停后端,前端仍开**

Run:
```bash
cd /work/chayuan-desktop/docker
sudo docker compose -f docker-compose.split.yaml stop chayuan-server
curl -fsS http://localhost:8080/healthz && echo " <- 前端仍在(后端已停)"
sudo docker compose -f docker-compose.split.yaml start chayuan-server
```
Expected: 后端停掉后 `http://localhost:8080/` 仍能打开(API 调用返错误/502,但页面不死)—— 证明解耦达成。重启后端后,client 靠 resolver 自动恢复反代(无需重启 client)。

- [ ] **Step 7: 记录结果**

把 Step 2-6 实际输出回填到本任务下;若 server build 因磁盘/依赖失败,记录错误,不要谎报成功(见 CLAUDE.md 红线)。

---

## Self-Review(作者已过)

- **Spec 覆盖**:设计 §4 server 镜像→Task 1+2;§5 client 镜像+nginx→Task 3+4;§6 compose→Task 5;§7 解耦收益→Task 6 Step6 验证;§9 验证清单→Task 6 全覆盖。无遗漏。
- **占位符**:无 TBD;健康端点已核实为 `/healthz`(health_routes.py),非占位。
- **一致性**:容器名 `chayuan-server` 在 nginx.split.conf 的 `proxy_pass`、compose 的 `container_name`、healthcheck 三处一致;镜像名 `chayuan-server:split` / `chayuan-client:split` 一致;前端产物路径 `apps/web/dist`→`/usr/share/nginx/html` 一致。
- **范围**:不动单镜像四件套;不做 TLS/扩容/外层代理(YAGNI)。

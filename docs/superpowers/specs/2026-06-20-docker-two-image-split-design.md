# 设计：Docker 两镜像拆分部署（chayuan-server / chayuan-client 解耦）

日期：2026-06-20
状态：已通过设计评审，待写实现计划
范围：`/work/chayuan-desktop/docker/`（与现有单镜像**共存**，不删旧文件）

## 1. 问题与根因

**症状**：docker 部署后浏览器打不开前端页面；而独立启动客户端 + 服务端可以正常打开。

**根因（架构耦合）**：当前是**单镜像**——一个容器里 entrypoint 同时跑 nginx（:80 前端+反代）
和 chayuan-server（:62581）+ config_panel（:8502）：

```
entrypoint.sh: nginx -g 'daemon off;' &   # 后台
               exec python -m chayuan ...  # 前台,PID 2
```

`exec python` 在前台；**后端进程一旦退出（崩溃 / 启动失败 / OOM / 磁盘满），entrypoint 退出
→ tini(PID1) 回收整个容器 → nginx 一起死 → 前端页面直接打不开**。后端很重（torch /
sidecar / 模型 / 依赖），加上构建机磁盘长期临界（98%），启动极易失败，于是「前端打不开」。
独立启动时前端是独立进程，后端崩了前端照样在 —— 这正是要解耦的点。

（另注：早前已修过两个相关坑——Dockerfile 误 build apps/desktop 致首屏 invoke 白屏、
默认 compose 的源码热替换 bind mount 盖掉镜像产物。本设计是更彻底的结构解耦。）

## 2. 目标

- 前端服务与后端进程**解耦到两个镜像/容器**：后端崩溃不再拖死前端页面。
- 「容器名访问」正确落地：client nginx 在 docker 网络内用容器名反代 server。
- client 镜像轻（无 Python/torch），server 镜像可独立 headless 运行。
- 与现有单镜像**共存**（保留 `Dockerfile` / `entrypoint.sh` / `nginx.conf` /
  `docker-compose.yaml` 不动），新增 split 套件。

## 3. 拓扑

```
[浏览器 @ 宿主机] --:8080--> [chayuan-client 容器: nginx + React SPA(含 admin)]
                                  │ docker 网络内,容器名解析
                                  │ /api /v1 /chat … 反代
                                  ▼
                           [chayuan-server 容器: FastAPI :62581 + sidecars]
                                  ▲ (可选) :62581 也映射宿主 → WPS / Tauri / 三方 OpenAI SDK 直连
```

**关键纠正**：浏览器跑在宿主机上，**解析不了 `chayuan-server` 容器名**（容器名仅在 docker
网络内可解析）。所以：
- 前端构建 `VITE_API_BASE=""` → 浏览器走**同源相对路径**到 client(:8080)，无 CORS。
- **client nginx（网络内）**用 `http://chayuan-server:62581` 反代 → 这才是容器名访问的正确位置。
- 绝不能把 `VITE_API_BASE` 设成容器名（浏览器会解析失败）。

## 4. 镜像 A：chayuan-server（后端，重）

- 新增 `docker/Dockerfile.server`：复用现有 all-in-one 的**后端层**（poetry install --only main
  --no-root + chayuan / langchain_chayuan 源码 + vendor/services sidecar + bundled_fonts/bgm/
  video_clips 资产），**删掉** web-builder 阶段、删掉 nginx 安装与前端 `COPY --from=web-builder`。
- 新增 `docker/entrypoint.server.sh`：保留数据目录初始化 + config symlink，**不起 nginx**，
  结尾 `exec python -m chayuan start -a --single-machine`。
- `EXPOSE 62581`（8502 split 不用，可留可去）。
- `HEALTHCHECK`：直打后端健康端点（实现时核实路径，候选 `/healthz` `/live` `/ready`）。
- 卷：`data` / `bundled_models` / `config` / `logs` 与现单镜像一致。
- 运行时 env 同现状（CHAYUAN_PROFILE=single-machine / sqlite-vec / inproc / linux-x64 等）。

## 5. 镜像 B：chayuan-client（前端，轻）

- 新增 `docker/Dockerfile.client`：
  - 构建阶段 `node:20-bookworm-slim`：复刻现有 web-builder（pnpm install + `pnpm -F web
    build:vite`，VITE_API_BASE="" / VITE_THIN_CLIENT=0），产出 `apps/web/dist`。
  - 运行阶段 `nginx:alpine`：只 `COPY --from=builder .../apps/web/dist /usr/share/nginx/html`
    + `COPY docker/nginx.split.conf`。**无 Python / torch / sidecar**。
- 新增 `docker/nginx.split.conf`：
  - serve SPA：`root /usr/share/nginx/html; try_files $uri $uri/ /index.html;`
  - API 反代用 **docker 内嵌 DNS resolver + 变量 proxy_pass，每请求重新解析**：

    ```nginx
    resolver 127.0.0.11 valid=10s ipv6=off;
    location ~ ^/(api|v1|chat|knowledge_base|knowledge_universe|knowledge_source|admin|runtime|model_registry|tools|tool|prompts|temp|file|files|media|img|status|live|ready|metrics|conversation|user|users|auth|kb-query|sse|sidecar|install_jobs|annotation|llm|llm_model|ai_platform|local_runtime|provider|capability|home)(/|$) {
        set $up http://chayuan-server:62581;
        proxy_pass $up;
        # SSE/大文件:proxy_buffering off; proxy_read_timeout 3600s; client_max_body_size 1024m; (同现 nginx.conf)
    }
    ```

    **为什么不用静态 `upstream { server chayuan-server:62581; }`**：静态 upstream 只在 nginx
    **启动时解析一次** DNS——server 容器还没起 → nginx 启动直接报 host not found 失败；
    server 重启换 IP → nginx 仍打旧 IP → 502。变量 proxy_pass + resolver 每请求重解析，规避两者。
  - `location = /healthz { return 200 "ok\n"; }`（client 自身存活探针）。
  - **不反代 8502**（admin 已 React 重构进 apps/web SPA，走 /api 即可）。
  - 反代路径清单沿用现 nginx.conf 的 location 正则（保持前端契约一致）。

## 6. docker/docker-compose.split.yaml

- service `chayuan-server`：build `docker/Dockerfile.server`，挂 data/bundled_models/config/logs，
  `restart: unless-stopped`，可选 `ports: ["62581:62581"]`（给 WPS/三方直连；默认可不暴露，
  仅网络内）。healthcheck 同镜像。
- service `chayuan-client`：build `docker/Dockerfile.client`，`ports: ["8080:80"]`，
  `depends_on: { chayuan-server: { condition: service_started } }`，`restart: unless-stopped`。
- 共享 compose 默认网络（容器名互通）。

启动：`cd docker && docker compose -f docker-compose.split.yaml up -d --build`

## 7. 解耦收益（直接解决主诉）

- **server 崩 ≠ 前端死**：client 独立容器，后端挂了页面照开，API 调用返错误而非整页打不开。
- client 镜像小、构建快、无 Python；server 镜像可独立 headless / API-only 部署。
- 各自重建 / 升级 / 重启互不影响；server 重启时 client 靠 resolver 重连。

## 8. 不在本次范围（YAGNI）

- 不删 / 不改现有单镜像（`Dockerfile` / `entrypoint.sh` / `nginx.conf` /
  `docker-compose.yaml`）—— 用户选择两者共存。
- 不做多副本扩容 / 负载均衡 / TLS / 反向代理外层（单机部署足够）。
- 不动后端业务代码、不改前端构建配置（仅复用现有 `pnpm -F web build:vite`）。

## 9. 风险与验证

- **磁盘**：构建机 98% 满，两镜像（尤其 server 带 torch/sidecar）可能 build 失败 → 先腾盘。
- **健康端点路径**：实现时需核实后端真实健康 path（不要凭记忆）。
- **反代路径清单漂移**：前端新增路由组若不在 location 正则里会 404（见 web-dev-proxy-allowlist
  教训）—— 与现 nginx.conf 保持同一份清单，后续新增同步两处。
- 验证：`docker compose -f docker-compose.split.yaml up -d --build` 后
  ① `curl http://localhost:8080/healthz` → ok
  ② 浏览器开 `http://localhost:8080/` → 页面正常 + 不报 invoke
  ③ 故意停 `chayuan-server` 容器 → 前端页面仍能打开（API 返错误，验证解耦）
  ④ `docker compose restart chayuan-server` 后前端 API 自动恢复（验证 resolver 重连）。

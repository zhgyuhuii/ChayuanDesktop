# chayuan 生产部署（Docker Compose）

本目录提供**开箱即用**的生产镜像与一键 compose 编排，默认组件：

```
                 ┌─ Nginx (可选 TLS / 限流) ─┐
                 │                           │
   浏览器 / SDK ▶│   /healthz active check    │
                 │                           │
                │  ┌── chayuan-api (N)  ──┐ │
                 │  │   + chayuan-panel    │ │
                 │  │   + chayuan-worker   │ │
                 │  └──┬────────┬──────────┘ │
                 │     │        │            │
                 │  Postgres  Redis  Milvus  │
                 └───────────────────────────┘
```

所有 `chayuan-*` 服务共用同一个镜像，区别只是 `CMD`（`api / panel / worker`），
入口脚本按角色分派。

## 目录结构

```
docker/prod/
├── README.md              ← 本文件
├── Dockerfile             ← 多阶段构建的 chayuan-server 镜像
├── entrypoint.sh          ← 容器入口：init → 探依赖 → 启动
├── docker-compose.yaml    ← 全栈编排（app/worker/panel + pg/redis/milvus）
├── env.example            ← 环境变量样例
└── docker-compose.prod.yaml  ← 历史模板（已被上面的 docker-compose.yaml 取代，仅留参考）
```

## 快速开始

```bash
cd docker/prod/
cp env.example .env

# ⚠️ 必须改：生成一个强随机 JWT_SECRET
python -c "import secrets;print(secrets.token_urlsafe(48))" \
  | xargs -I{} sed -i.bak 's|^JWT_SECRET=.*|JWT_SECRET={}|' .env

# 构建并启动（第一次 ~10 分钟，看带宽）
docker compose up -d --build

# 跟踪初始化进度
docker compose logs -f chayuan-api
```

首次启动时 `chayuan-api`（和其它 chayuan 服务）会：

1. 检测到 `/data/basic_settings.yaml` 不存在，自动运行 `chayuan init --profile prod -q`；
2. 生成的 YAML 里 `SQLALCHEMY_DATABASE_URI` 指向 `postgres:5432`、
   `DEFAULT_VS_TYPE=milvus` → `milvus:19530`、`REDIS_URL=redis://redis:6379/0`、
   `AUTH_REQUIRED=true` 等；
3. TCP 探活 pg / redis / milvus 就绪后，再 `exec chayuan start --api`；
4. 首次启动日志里会打印一次 **admin 初始密码**（若 `AUTH_DEFAULT_ADMIN_PASSWORD` 未设）——
   请立即通过 `/auth/users/{id}/password` 或配置面板改掉。

## 健康检查

```bash
curl -fsS http://127.0.0.1:62581/healthz    # liveness
curl -fsS http://127.0.0.1:62581/readyz     # 依赖就绪
curl -fsS http://127.0.0.1:62581/metrics    # Prometheus
```

NiceGUI 配置面板：http://host:8502

## 横向扩展

- 把 `chayuan-api` 做成多副本：`docker compose up -d --scale chayuan-api=N`，
  配合外层 nginx/haproxy 做七层 round-robin；
- `chayuan-worker` 也可横向扩展（`--scale chayuan-worker=3`），Arq 会自动瓜分队列；
- Postgres / Milvus 生产应该外置：把 `CHAYUAN_PG_HOST` / `CHAYUAN_MILVUS_HOST` 指到集群 VIP，
  并在 compose 里移除内置的 postgres / milvus 服务。

调优细节见 [`docs/scalability.md`](../../docs/scalability.md)。

## 镜像仅构建（不跑 compose）

```bash
# 版本号对齐 libs/chayuan-server/pyproject.toml（SSOT）。
# 如果你想自动带上版本 tag，可以这样：
VERSION=$(python -c "import importlib.metadata, sys; \
  sys.path.insert(0,'libs/chayuan-server'); \
  from chayuan import __version__; print(__version__)")
echo "building chayuan-server:${VERSION}"

# 在仓库根目录执行
docker build -f docker/prod/Dockerfile -t chayuan-server:${VERSION} .

# 也可以直接 run，手动提供 pg/redis/milvus 连接信息
docker run --rm -it \
  -p 62581:62581 \
  -e JWT_SECRET="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  -e CHAYUAN_PG_HOST=host.docker.internal \
  -e CHAYUAN_REDIS_URL=redis://host.docker.internal:6379/0 \
  -e CHAYUAN_MILVUS_HOST=host.docker.internal \
  -v chayuan-data:/data \
  chayuan-server:${VERSION} api
```

## 常见命令

```bash
# 日志
docker compose logs -f chayuan-api
docker compose logs -f chayuan-worker

# 进入容器排查
docker compose exec chayuan-api bash
docker compose exec chayuan-api chayuan status

# 重新初始化（会写 YAML，不会动数据）
docker compose run --rm chayuan-api init

# 强行停服清数据（危险）
docker compose down -v
```

## 切回 local 默认（sqlite+faiss）

只为体验时，完全可以不跑这一套。用仓库根的 `docker/docker-compose.yaml`（社区镜像版）
或直接本机 `pip install chayuan-server && chayuan init && chayuan start -a` 即可；
本目录下的一切仅面向"要多用户、要并发、要把向量库 / RDBMS / Redis 拉出来"的生产场景。

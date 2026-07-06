# ChaCMD 指挥调度平台 — 运行说明

> ✅ **统一环境：chacmd 与察元共用同一个 Python env。** chacmd 的**全部依赖（含 dev 工具）已对齐察元区间**（`fastapi<0.110` / `uvicorn>=0.27` / `sqlalchemy~2.0.25` / `pydantic~2.11.1` / `websockets>=12` / `pytest^7.3` / `ruff^0.1.5`），**直接装进察元的 env 不会顶掉察元任何依赖**。实测：在察元原版版本（fastapi 0.109.2 / uvicorn 0.27.1 / pydantic 2.11.10 / pytest 7.4.4 / ruff 0.1.15）下 **238 tests + ruff 全绿**。装进察元 env 后，察元后端与 chacmd orchestrator 从**同一 env** 各起进程（:8000 / :8100）。
>
> 若曾用早期版本（`fastapi>=0.115`）把察元 py312 env 装坏，恢复：`pip install "fastapi==0.109.2" "starlette==0.36.3" "pytest==7.4.4" "pytest-asyncio==0.23.8"`，再 `pip install -e <chacmd>` 即可回到统一环境。

ChaCMD（察CMD）= 察元母体（chayuan-desktop）之上的「跨容器横向调度」增量，作为 monorepo 内一个 SKU。
本系统由**两个项目**协作：

| 项目 | 角色 | 仓库 |
|---|---|---|
| **ChaCMD 指挥系统**（本目录 + 前端 SKU） | **中央编排/调度**——反连网关、派活、DAG、Job-Task 状态机、事件总线、**任务调度器**、指挥大屏 | `/work/chayuan-desktop`（`chacmd/` 后端 + `chayuan-client/` 前端） |
| **chatop 工位镜像** | **执行侧**——KasmVNC 云桌面容器 = 一名数字员工的工作站，内含 `agent-bridge` 反连客户端 | `/work/chatop` |

**协作方式（反向 WS，NAT/隔离友好）**：chatop 容器内的 `agent-bridge` 主动**反连**到 ChaCMD 网关（`ws://<chacmd-host>:8767/bridge`）按昵称注册 + 心跳；ChaCMD 经该隧道下推派活，容器执行后把事件流回传。中央**不主动连容器**（容器无对外 IP）。

---

## 一、ChaCMD 指挥系统（chayuan-desktop）

### 1. 后端（chacmd）

要求 Python ≥ 3.11。依赖已全对齐察元，**推荐直接装进察元的同一个 Python env（统一环境）**。

```bash
# 统一环境（推荐）：激活察元的 env（poetry venv 或 conda py312），直接装 chacmd
#   —— 全部依赖已对齐察元区间，不会顶掉察元任何依赖
conda activate py312            # 或察元的 poetry shell
pip install -e "/work/chayuan-desktop/chacmd[dev]"

# 或独立 env（纯逻辑开发/CI，不联调察元时）
# python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"

# 跑测试（238 tests，全部纯逻辑，无需基建）
cd /work/chayuan-desktop/chacmd
pytest -q
ruff check .
```

**零基建快速启动**（SQLite + 内存总线 + Fake 沙箱/适配器，本机即可跑）：

```bash
export CHACMD_DB_URL="sqlite+aiosqlite:///./chacmd.db"
export CHACMD_EVENT_BUS=memory        # memory | nats
export CHACMD_SANDBOX=fake             # fake | docker
export CHACMD_AGENT_ADAPTER=fake       # fake | openhands
python -m chacmd.cli start
```

启动后：
- **HTTP API**：`http://0.0.0.0:8100`（任务/审批/容器）
- **大屏事件流 SSE**：`GET http://localhost:8100/api/v1/stream`
- **反连网关**（agent-bridge 连这里）：`ws://0.0.0.0:8767/bridge`

**生产/联调配置**（按需覆盖 env）：

| env | 默认 | 说明 |
|---|---|---|
| `CHACMD_DB_URL` | `postgresql+asyncpg://chacmd:chacmd@127.0.0.1:5432/chacmd` | 状态库（方言无关，支持 SQLite/PG/达梦）|
| `CHACMD_EVENT_BUS` | `memory` | `nats` 时用 `CHACMD_NATS_URL`（默认 `nats://127.0.0.1:4222`）|
| `CHACMD_SANDBOX` | `fake` | `docker` 时真起容器，镜像 `CHACMD_SANDBOX_IMAGE`（默认 `chatop-ai:latest`）|
| `CHACMD_AGENT_ADAPTER` | `fake` | `openhands` 接真 agent 运行时 |
| `CHAYUAN_BASE_URL` / `CHAYUAN_WEB_URL` | `http://127.0.0.1:8000` / `:5173` | 察元网关/前端（模型/kb-query 经此）|
| `CHACMD_API_PORT` / `CHACMD_GATEWAY_PORT` | `8100` / `8767` | 端口 |
| `CHACMD_JOB_TOKEN_BUDGET` | `100000` | per-job token 硬预算（0=不限）|

**任务调度器**（`chacmd/scheduler/`）：九步工单状态机 · ready 队列取单（优先级/并发/互斥）· 三级成本熔断 · 模型分层+涉密路由 · GitLab/CI webhook 事件源 · 调度循环 `scheduler_tick`。当前为库模块（经 `Dispatcher` 复用反连网关派活）；周期 tick 守护进程 + 真 Redis 互斥锁/GitLab webhook 接线待真基建环境。

### 2. 前端（chayuan-client，指挥大屏 SKU）

要求 Node ≥ 20 + pnpm。

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm install

# 指挥大屏 SKU 开发
pnpm --filter @chayuan/chacmd dev            # vite dev server

# 校验（本环境可跑）
pnpm --filter @chayuan/chacmd-features typecheck
pnpm exec vitest run packages/chacmd-features/src   # 35 tests

# 打包
pnpm --filter @chayuan/chacmd build
```

大屏默认落地 `/command`（3D 星群 + KPI + 员工卡 + 驾驶舱/投墙双模式）；`?mode=kiosk` 进投墙。数据源 = 后端 `/api/v1/stream`。首启走察元基座的数据目录/DB 配置门（单机 SQLite / 网络版后台配置），不被 SKU 绕过。

---

## 二、chatop 工位镜像（执行侧）

详见 `/work/chatop/README.md`。要点：

```bash
cd /work/chatop
cp .env.example .env        # 按需改端口/密码
./build-and-run.sh          # 构建 chatop-ai 镜像并起容器
# 访问 https://localhost:${PORT:-6901}
```

容器内 `agent-bridge`（`/work/chatop/agent-bridge`）作为常驻服务反连 ChaCMD 网关：
- 连接：`ws://<chacmd-host>:8767/bridge`
- 注册：按 `nickname`（逻辑标识，非 IP）+ 所属 `dept`
- 心跳：默认每 10s

> 部署形态：ChaCMD 调度器 + 数字员工容器均在 DMZ 隔离区；宿主禁 IP 转发、容器互不可见，故只能反向 WS。涉密任务（`classification: secret`）由调度器强制拦截、不派 DMZ、只走本地 vLLM。

---

## 三、端到端最小联调（本机）

```bash
# 终端 1：起 ChaCMD 后端（零基建）
cd /work/chayuan-desktop/chacmd && . .venv/bin/activate
export CHACMD_DB_URL="sqlite+aiosqlite:///./chacmd.db" CHACMD_EVENT_BUS=memory CHACMD_SANDBOX=fake CHACMD_AGENT_ADAPTER=fake
python -m chacmd.cli start           # API :8100 + 网关 :8767

# 终端 2：起指挥大屏
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/chacmd dev

# 终端 3：起工位容器（agent-bridge 会反连 :8767 注册）
cd /work/chatop && ./build-and-run.sh
```

浏览器开大屏 → 星群里应出现已注册工位/员工节点，状态灯随事件总线实时变。

真起容器/GitLab/LiteLLM/NATS/Redis 等生产基建的端到端冒烟需对应部署环境（DMZ）。

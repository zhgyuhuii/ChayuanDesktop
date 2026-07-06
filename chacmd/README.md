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

**零基建快速启动（推荐用 yaml，免每次设一堆环境变量）**：

```bash
cp chacmd.example.yaml chacmd.yaml     # 已内置 sqlite + memory + fake，开箱即跑
python -m chacmd.cli start             # 自动读 ./chacmd.yaml；或 -c 路径/chacmd.yaml
```

> 配置分层（对齐察元 `chayuan_core.config`）：**字段默认值 < yaml < 环境变量**。yaml 搜索顺序 `-c 参数` → `$CHACMD_CONFIG` → `./chacmd.yaml`。Windows 上不用再逐行 `$env:`——改 `chacmd.yaml` 即可。

启动后终端会打印 banner（配置来源 / 各端口），并可访问：
- **状态页**：`http://localhost:8100/`（浏览器打开有 JSON 状态页，不再 404）· **健康**：`/healthz` · **API 文档**：`/docs`
- **大屏事件流 SSE**：`GET /api/v1/stream`
- **反连网关**（agent-bridge 连这里）：`ws://localhost:8767/bridge`

**配置项**（yaml 键名 = 下表；对应环境变量可覆盖，样例见 `chacmd.example.yaml`）：

| yaml 键 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `db_url` | `CHACMD_DB_URL` | `postgresql+asyncpg://…:5432/chacmd` | 状态库（方言无关，SQLite/PG/达梦）|
| `chayuan_base_url` | `CHAYUAN_BASE_URL` | `http://127.0.0.1:8000` | 察元后端（模型/kb-query 经此；形态 B 桌面用 `:62581`）|
| `event_bus` | `CHACMD_EVENT_BUS` | `memory` | `nats` 时用 `nats_url` |
| `sandbox` | `CHACMD_SANDBOX` | `fake` | `docker` 时真起容器（`sandbox_image`）|
| `agent_adapter` | `CHACMD_AGENT_ADAPTER` | `fake` | `openhands` 接真 agent |
| `api_port` / `gateway_port` | `CHACMD_API_PORT` / `CHACMD_GATEWAY_PORT` | `8100` / `8767` | 端口 |
| `default_token_budget` | `CHACMD_JOB_TOKEN_BUDGET` | `100000` | per-job token 硬预算（0=不限）|

**任务调度器**（`chacmd/scheduler/`）：九步工单状态机 · ready 队列取单（优先级/并发/互斥）· 三级成本熔断 · 模型分层+涉密路由 · GitLab/CI webhook 事件源 · 调度循环 `scheduler_tick`。当前为库模块（经 `Dispatcher` 复用反连网关派活）；周期 tick 守护进程 + 真 Redis 互斥锁/GitLab webhook 接线待真基建环境。

### 2. 前端（chayuan-client，双 SKU 切换打包）

要求 Node ≥ 20 + pnpm。**同一份代码、两档构建**——只差构建命令与主页（§3.7）：

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm install

# ── 切换开发 ──
pnpm dev:desktop      # 察元 SKU（主页 察元 AI）
pnpm dev:chacmd       # ChaCMD SKU（主页 指挥大屏）

# ── 切换打包（实证：产物 title 分别为「察元 AI」/「ChaCMD 指挥台」）──
pnpm build:desktop    # 察元 SKU → apps/desktop/dist
pnpm build:chacmd     # ChaCMD SKU → apps/chacmd/dist（实测 ✓ built，独立 61M 产物）

# 校验
pnpm --filter @chayuan/chacmd typecheck
pnpm --filter @chayuan/chacmd-features typecheck
pnpm exec vitest run packages/chacmd-features/src   # 35 tests
```

察元 SKU 脚本零改动、行为不变；`dev:chacmd`/`build:chacmd` 为**新增档**（additive）。大屏默认落地 `/command`（3D 星群 + KPI + 员工卡 + 驾驶舱/投墙双模式），`?mode=kiosk` 进投墙；数据源 = 后端 `/api/v1/stream`；首启仍走察元基座 DB 配置门，不被 SKU 绕过。

> **桌面（Tauri）档待建**：`apps/chacmd` 目前是网络版 SKU（有 vite，无 `src-tauri/`）。桌面安装包档需补 `apps/chacmd/src-tauri/`（独立 `productName/identifier/icon` = 独立安装包）+ 一个平行 `build-chacmd.sh`（不改已有 `build-desktop.sh`）。属打包阶段独立任务。

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

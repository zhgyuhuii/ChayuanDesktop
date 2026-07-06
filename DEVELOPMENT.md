# 开发与打包指南（chayuan-desktop 母体 · 双 SKU）

本仓是察元（Chayuan）桌面版 monorepo，同一份代码经**两档构建**产出两个 SKU：

| SKU | 主页 | 后端 | 说明 |
|---|---|---|---|
| **察元 AI**（现状） | 察元工作台 | 察元 chayuan-server | 现有产品，独立可部署 |
| **ChaCMD 指挥台**（增量） | 指挥大屏 | 察元 chayuan-server + `chacmd/` orchestrator | 跨容器横向调度增量，复用察元母体 |

> 两 SKU **只差**：开发/构建命令、产出物、docker 镜像名、主页。依赖单向 `chacmd → 察元`，察元核心永不 import chacmd（详见 `docs/superpowers/specs/2026-06-30-chacmd-design.md` §3.5–3.9）。
> 子容器工位镜像（KasmVNC 数字员工）在独立仓 `/work/chatop`，不在本仓。

---

## 1. 前置要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Node | ≥ 20.10 | 前端 |
| pnpm | 9.15.4（`packageManager` 已锁） | 前端 workspace |
| Python | 3.11 或 3.12（察元 `>=3.10,<3.13`，chacmd `>=3.11` → 取交集 3.11/3.12） | 后端 |
| Poetry | 最新 | 察元后端依赖管理 |
| Rust + Tauri CLI | 见 tauri 文档 | 仅桌面安装包打包需要 |
| Docker | 可选 | 仅真起子容器/沙箱需要 |

---

## 2. 一次性环境搭建

### 2.1 前端（chayuan-client）

```bash
cd chayuan-client
pnpm install          # 安装整个 workspace（察元 + ChaCMD 两个 app 壳共用 packages/*）
```

### 2.2 后端 —— 统一 Python 环境（察元 + chacmd 同一个 env）

chacmd 全部依赖已对齐察元区间，**装进察元同一个 env 不会顶掉察元任何依赖**（实测 238 tests + ruff 在察元原版版本下全绿）。

```bash
# ① 察元后端（Poetry，重依赖含 langchain/torch 等，依察元自身说明）
cd chayuan-server/libs/chayuan-server
poetry install                 # 建/装察元后端 env

# ② 在同一个 env 里装 chacmd（统一环境）
poetry run pip install -e /work/chayuan-desktop/chacmd[dev]
#   或激活该 env 后： pip install -e /work/chayuan-desktop/chacmd[dev]
```

> 也可给 chacmd 单独建 env（`python -m venv .venv && pip install -e ".[dev]"`）做纯逻辑开发/CI；联调察元时用统一 env 最省事。

---

## 3. 开发态运行（切换运行）

两 SKU 前后端各自独立、端口错开、可并存对比。

| SKU | 前端 | 后端 | 端口（前/后） |
|---|---|---|---|
| **察元** | `pnpm dev:desktop`（或 `pnpm dev` 网络版） | `poetry run chayuan start -a`（或 `python cli.py start -a`） | 5173 / 8000 |
| **ChaCMD** | `pnpm dev:chacmd` | `python -m chacmd.cli start` | 5173* / 8100 |

`*` 两个前端 vite 默认端口都是 5173（`strictPort:false`）——同时跑时第二个自动占 5174；要固定可 `pnpm dev:chacmd -- --port 5174`。

**ChaCMD 联调**（大屏 + 调度 + 察元能力）需三个进程：

```bash
# 终端 1：察元后端（模型网关/kb-query/RBAC 的真源）
cd chayuan-server/libs/chayuan-server && poetry run chayuan start -a       # :8000

# 终端 2：chacmd orchestrator（配 CHAYUAN_BASE_URL 指向察元）
export CHAYUAN_BASE_URL=http://127.0.0.1:8000
export CHACMD_DB_URL="sqlite+aiosqlite:///./chacmd.db" CHACMD_EVENT_BUS=memory CHACMD_SANDBOX=fake CHACMD_AGENT_ADAPTER=fake
python -m chacmd.cli start                                                 # :8100（+ 反连网关 :8767）

# 终端 3：指挥大屏前端
cd chayuan-client && pnpm dev:chacmd
```

chacmd 后端环境变量全表见 `chacmd/README.md`。

---

## 4. 打包 / 编译（切换打包）

### 4.1 前端（两档，已验证）

```bash
cd chayuan-client
pnpm build:desktop     # 察元 SKU → apps/desktop/dist （产物 <title>察元 AI</title>）
pnpm build:chacmd      # ChaCMD SKU → apps/chacmd/dist （产物 <title>ChaCMD 指挥台</title>，实测 ✓ built）
```

同一份 `packages/*` 基座，只换 app 壳 + BrandConfig（主页）。察元脚本零改动，`*:chacmd` 为新增档。

### 4.2 桌面安装包

```bash
# 察元 SKU（现有，三档 flavor 互斥，不带 = 三档都打）
./build-desktop.sh --lite-only        # 轻量版（不嵌模型）
./build-desktop.sh --standard-only    # 标准版
./build-desktop.sh --full-only        # 全量版（随包带模型权重）
```

> **ChaCMD 桌面安装包档：待建。** `apps/chacmd` 目前是网络版 SKU（有 vite，无 `src-tauri/`）。桌面档需补 `apps/chacmd/src-tauri/`（独立 `productName/identifier/icon` = 独立安装包）+ 平行 `build-chacmd.sh`（复用 `build-desktop.sh` 公共步骤，**不改**已有脚本）。属打包阶段独立任务。

### 4.3 后端

- 开发：`python -m chacmd.cli start`（察元 `chayuan start -a`）。
- 打包：桌面 SKU 里后端以 PyInstaller sidecar 随包；ChaCMD 全量形态 = 察元 sidecar + chacmd orchestrator（同机同环境两进程，§3.9 形态 B）。轻量挂载形态（形态 C）= 只打指挥 UI，全 HTTP 对接已部署察元。

---

## 5. 测试与校验

```bash
# chacmd 后端（238 tests，纯逻辑无需基建）
cd chacmd && pytest -q && ruff check .

# 前端
cd chayuan-client
pnpm --filter @chayuan/chacmd typecheck
pnpm --filter @chayuan/chacmd-features typecheck
pnpm exec vitest run packages/chacmd-features/src        # 35 tests
```

---

## 6. 端口规划

| 服务 | 端口 |
|---|---|
| 察元前端（web/desktop dev） | 5173 |
| ChaCMD 前端（dev） | 5173→5174（自动） |
| 察元后端 | 8000 |
| chacmd orchestrator（HTTP API） | 8100 |
| chacmd 反连网关（agent-bridge 连入） | 8767 |
| chacmd 大屏事件流 SSE | `GET :8100/api/v1/stream` |

---

## 7. 相关文档

- `chacmd/README.md` — chacmd 后端运行、env 全表、调度器、零基建启动。
- `chatop`（独立仓）`/work/chatop/README.md` — KasmVNC 工位镜像（执行侧）。
- `docs/superpowers/specs/2026-06-30-chacmd-design.md` — 架构真源（§3.5 母体复用 / §3.6 集成治理 / §3.7 前端双 SKU / §3.8 双 SKU 命令 / §3.9 三形态）。
- `docs/superpowers/specs/2026-07-05-chacmd-placement-and-requirements-master.md` — 落点与需求总纲。

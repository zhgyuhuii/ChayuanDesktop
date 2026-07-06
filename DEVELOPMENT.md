# 开发与打包指南（chayuan-desktop 母体 · 双 SKU）

本仓是察元（Chayuan）桌面版 monorepo，同一份代码经**两档构建**产出两个 SKU：

| SKU | 主页 | 后端 | 说明 |
|---|---|---|---|
| **察元 AI**（现状） | 察元工作台 | 察元 chayuan-server | 现有产品，独立可部署 |
| **ChaCMD 指挥台**（增量） | 指挥大屏 | 察元 chayuan-server + `chacmd/` orchestrator | 跨容器横向调度增量，复用察元母体 |

> 两 SKU **只差**：开发/构建命令、产出物、docker 镜像名、主页。依赖单向 `chacmd → 察元`，察元核心永不 import chacmd（详见 `docs/superpowers/specs/2026-06-30-chacmd-design.md` §3.5–3.9）。
> 子容器工位镜像（KasmVNC 数字员工）在独立仓 `/work/chatop`，不在本仓。

> ⚠️ **平台语法**：下文命令默认给 **Windows PowerShell** 与 **bash(Linux/macOS)** 两种。PowerShell 里 **不能用 `&&` 连命令**（PS 5.1 报错），要分行或用 `;`；设环境变量用 `$env:X="v"`（不是 `export X=v`）；激活 venv 是 `.venv\Scripts\Activate.ps1`（不是 `. .venv/bin/activate`）。

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

## 2. 一次性环境搭建（按系统区分）

### 2.1 前端（所有系统相同）

```bash
cd chayuan-client
pnpm install          # 安装整个 workspace（察元 + ChaCMD 两个 app 壳共用 packages/*）
```

### 2.2 后端 —— 统一 Python 环境（察元 + chacmd 同一个 env）

chacmd 全部依赖已对齐察元区间，**装进察元同一个 env 不会顶掉察元任何依赖**（实测 238 tests + ruff 在察元原版版本下全绿）。分系统操作：

#### 🪟 Windows（PowerShell）

```powershell
# ① 察元后端（Poetry，重依赖含 langchain/torch，依察元自身说明）
cd chayuan-server\libs\chayuan-server
poetry install

# ② 在同一个 env 里装 chacmd —— 用已有 conda env 也可（推荐，你现有 py312）
conda activate py312                              # 或 poetry shell
pip install -e "D:\...\chayuan-desktop\chacmd[dev]"   # 路径按你本机；[dev] 必须带引号

# （备选）给 chacmd 单独建 venv —— 注意 PS 不能用 && ，要分行
# python -m venv .venv
# .venv\Scripts\Activate.ps1
# pip install -e ".[dev]"
```

#### 🐧 Linux / macOS（bash）

```bash
# ① 察元后端
cd chayuan-server/libs/chayuan-server
poetry install

# ② 同一个 env 里装 chacmd（统一环境）
poetry run pip install -e /work/chayuan-desktop/chacmd[dev]
#   或激活该 env 后： pip install -e /work/chayuan-desktop/chacmd[dev]

# （备选）单独 venv：
# python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
```

---

## 3. 开发态运行（切换运行）

两 SKU 前后端各自独立、端口错开、可并存对比。前端命令跨平台一致：`pnpm dev:desktop`（察元）/ `pnpm dev:chacmd`（指挥台）。两个 vite 默认端口都是 5173（`strictPort:false`，同时跑时第二个自动占 5174）。

后端 + 环境变量按系统区分。**ChaCMD 联调需三个进程**（察元后端 + chacmd orchestrator + 大屏前端）：

#### 🪟 Windows（PowerShell）

```powershell
# 终端 1：察元后端
cd chayuan-server\libs\chayuan-server ; poetry run chayuan start -a          # :8000

# 终端 2：chacmd orchestrator（$env: 设变量，逐行，不用 &&）
$env:CHAYUAN_BASE_URL   = "http://127.0.0.1:8000"
$env:CHACMD_DB_URL      = "sqlite+aiosqlite:///./chacmd.db"
$env:CHACMD_EVENT_BUS   = "memory"
$env:CHACMD_SANDBOX     = "fake"
$env:CHACMD_AGENT_ADAPTER = "fake"
python -m chacmd.cli start                                                   # :8100 (+ 网关 :8767)

# 终端 3：指挥大屏前端
cd chayuan-client ; pnpm dev:chacmd
```

#### 🐧 Linux / macOS（bash）

```bash
# 终端 1：察元后端
cd chayuan-server/libs/chayuan-server && poetry run chayuan start -a         # :8000

# 终端 2：chacmd orchestrator
export CHAYUAN_BASE_URL=http://127.0.0.1:8000
export CHACMD_DB_URL="sqlite+aiosqlite:///./chacmd.db" CHACMD_EVENT_BUS=memory CHACMD_SANDBOX=fake CHACMD_AGENT_ADAPTER=fake
python -m chacmd.cli start                                                   # :8100 (+ 网关 :8767)

# 终端 3：指挥大屏前端
cd chayuan-client && pnpm dev:chacmd
```

单 SKU 察元开发：起察元后端 + `pnpm dev:desktop` 即可。chacmd 后端环境变量全表见 `chacmd/README.md`。

---

## 4. 打包 / 编译（切换打包）

### 4.1 前端网络版（两档，跨平台，已验证）

```bash
cd chayuan-client
pnpm build:desktop     # 察元 SKU → apps/desktop/dist （产物 <title>察元 AI</title>）
pnpm build:chacmd      # ChaCMD SKU → apps/chacmd/dist （产物 <title>ChaCMD 指挥台</title>，实测 ✓ built）
```

同一份 `packages/*` 基座，只换 app 壳 + BrandConfig（主页）。察元脚本零改动，`*:chacmd` 为新增档。

### 4.2 桌面安装包（Tauri）

**ChaCMD 桌面档**（跨平台 pnpm 脚本，复用察元 src-tauri + `tauri.chacmd.conf.json` 配置覆盖，贴察元 thin 范式）：

```bash
cd chayuan-client
pnpm build:chacmd:desktop     # = 构建大屏前端 + tauri build --config src-tauri/tauri.chacmd.conf.json
pnpm dev:chacmd:desktop       # 桌面开发（tauri dev）
```

产出：`ChaCMD 指挥台` 品牌安装包（identifier `ai.chayuan.chacmd`，NSIS/.exe·AppImage·DMG），主页=指挥大屏。需本机装 Rust + Tauri CLI。

**察元桌面档**（现有，三档 flavor 互斥，不带 = 三档都打）——**按系统用不同脚本**：

| 系统 | 命令 |
|---|---|
| 🪟 Windows | `.\build-desktop.ps1 -LiteOnly` / `-StandardOnly` / `-FullOnly` |
| 🐧 Linux/macOS | `./build-desktop.sh --lite-only` / `--standard-only` / `--full-only` |

> **两处诚实说明**：①ChaCMD 桌面档目前打的是 §3.9 **形态 B** 的前端 + 察元后端 sidecar（继承察元 `resources`）；把 **chacmd orchestrator 也做成随包 sidecar** 需补 PyInstaller spec + `src-tauri/src/sidecar.rs` 起第二个进程——待做（在此之前 orchestrator 以独立进程 `python -m chacmd.cli start` 运行）。②本机无 Rust/Tauri 工具链时 `pnpm build:*:desktop` 不会产出安装包，需在打包机执行。

### 4.3 后端打包（chacmd orchestrator 随包 sidecar，形态 B）

开发态后端直接 `python -m chacmd.cli start`（察元 `chayuan start -a`），不用打包。

桌面全量（形态 B）要把 chacmd orchestrator 冻结成**第二个 sidecar**，与察元后端 sidecar 同装同起。三步（**均在打包机执行、需 PyInstaller + Rust/Tauri 工具链**）：

```bash
# ① 冻结 chacmd → dist/chacmd-server/ 并拷到 desktop src-tauri/resources/
#    （在装了 chacmd 的统一 env 里；spec 见 chacmd/packaging/pyinstaller/chacmd.spec）
cd chacmd && python packaging/pyinstaller/build.py

# ② 在 apps/desktop/src-tauri/tauri.chacmd.conf.json 的 bundle 里打开 resources：
#      "resources": ["chacmd-server/**/*"]
#    （察元后端 sidecar 的 resources 由基础 conf 继承，二者并存）

# ③ 打包（会把两个 sidecar 都 bundle 进安装包）
cd chayuan-client && pnpm build:chacmd:desktop
```

**③ 依赖 sidecar.rs 接线（察元核心 Rust，需手工加 + 编译验证）**：`apps/desktop/src-tauri/src/sidecar.rs` 现只起察元后端；要它在 **ChaCMD SKU** 下**也**起 chacmd orchestrator，需照它已有的察元 spawn 范式加一个平行启动——

- **镜像现有模式**：`app.path().resolve("chacmd-server/chacmd-server.exe", BaseDirectory::Resource)` → `Command::new(path)`，注入 env `CHAYUAN_BASE_URL=http://127.0.0.1:62581`（察元桌面 sidecar 口）+ `CHACMD_DB_URL=sqlite+aiosqlite:///<dataDir>/chacmd.db` + `CHACMD_API_PORT=8100`，后台线程 poll `http://127.0.0.1:8100/healthz`（chacmd 已有健康端点）。
- **必须 flag 门控**：只在 ChaCMD SKU 起（按 `app.config().identifier == "ai.chayuan.chacmd"` 判断，或编译期 feature / `CHACMD_ENABLED` env）。**察元 SKU 路径零改动**，保持逐字节纯净（§3.6 硬约束）。

> **诚实边界**：①②（spec + 冻结脚本 + resources 声明）已备好、可审；③ 的 sidecar.rs 改动**未落地**——它是察元核心 Rust，**我无法在本环境编译验证**，硬塞编译不过的 Rust 会连察元 SKU 的构建一起弄坏，故留作打包机上按上述配方应用 + `cargo build` 验证的一步。在此之前，桌面包里 chacmd orchestrator 可作**独立进程** `python -m chacmd.cli start` 与桌面 App 并跑（形态 B 的过渡形态）。

轻量挂载（形态 C）= 只打指挥 UI、全 HTTP 对接已部署察元，**不需要**本节的 sidecar 打包。

---

## 5. 测试与校验

后端（PowerShell 分行；bash 可用 `&&` 连）：

```powershell
# 🪟 Windows
cd chacmd
pytest -q
ruff check .
```
```bash
# 🐧 Linux/macOS
cd chacmd && pytest -q && ruff check .        # 238 tests，纯逻辑无需基建
```

前端（跨平台一致）：

```bash
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

---

## 8. 打包机 checklist —— ChaCMD 桌面全量安装包（形态 B）

以下步骤**必须在装齐工具链的打包机上执行**（前面几节里凡标「需打包机」的都汇总在此）。以 🪟 Windows 为主（你的平台），bash 差异随附。每步给**验证命令 + 预期产物**，一步不过不进下一步。

**前置（打包机装齐）**：Node ≥ 20.10 + pnpm 9.15.4 · Python 3.11/3.12（统一 env，含 chacmd 与 PyInstaller）· Rust stable + Tauri CLI。验证：

```powershell
node -v ; pnpm -v ; python --version
python -c "import PyInstaller; print('PyInstaller', PyInstaller.__version__)"
cargo --version ; pnpm --filter @chayuan/desktop exec tauri --version
```

| # | 步骤 | 命令（🪟 Windows PowerShell） | 验证 / 预期产物 |
|---|---|---|---|
| 1 | 大屏前端构建 | `cd chayuan-client ; pnpm build:chacmd` | `apps/chacmd/dist/index.html` 存在，`<title>` 为 `ChaCMD 指挥台` |
| 2 | 冻结 chacmd sidecar | `cd chacmd ; python packaging/pyinstaller/build.py` | 生成 `dist/chacmd-server/chacmd-server.exe`，并拷到 `chayuan-client/apps/desktop/src-tauri/resources/chacmd-server/`；命令尾行打印「已拷到」 |
| 3 | 冒烟 sidecar（可选但推荐） | `.\chacmd\dist\chacmd-server\chacmd-server.exe start`（另设 `$env:CHACMD_DB_URL`） | 进程起、`GET http://127.0.0.1:8100/healthz` 返 200 |
| 4 | 打开 resources 声明 | 编辑 `apps/desktop/src-tauri/tauri.chacmd.conf.json`，`bundle` 加 `"resources": ["chacmd-server/**/*"]` | JSON 合法（`python -c "import json;json.load(open(...))"`） |
| 5 | sidecar.rs 接第二进程 | 按 §4.3 配方改 `src-tauri/src/sidecar.rs`（identifier 门控 `ai.chayuan.chacmd`）→ `cd apps/desktop/src-tauri ; cargo check` | `cargo check` 通过（察元 SKU 路径不变）|
| 6 | 打桌面安装包 | `cd chayuan-client ; pnpm build:chacmd:desktop` | `apps/desktop/src-tauri/target/release/bundle/` 下出 `ChaCMD 指挥台` NSIS `.exe`（Win）/ AppImage（Linux）/ DMG（mac）|
| 7 | 装机验证 | 双击安装 → 启动 | 主页=指挥大屏；察元后端(:62581) + chacmd(:8100) 两 sidecar 都起；大屏星群有数据 |

> **🐧 bash 差异**：`;` → `&&`；exe 名去 `.exe`（`chacmd/dist/chacmd-server/chacmd-server`）；桌面脚本 Windows 用 `.\build-desktop.ps1`、Unix 用 `./build-desktop.sh`（但 ChaCMD 档统一走跨平台 `pnpm build:chacmd:desktop`）。

**回退**：第 5 步 `cargo check` 不过时，先不改 sidecar.rs、跳过第 5 步——桌面包仍可出（只含察元 sidecar），chacmd orchestrator 暂以独立进程 `python -m chacmd.cli start` 并跑（形态 B 过渡形态，功能不缺）。

**察元 SKU 不受影响**：全程只新增 `apps/chacmd`、`tauri.chacmd.conf.json`、`chacmd-server` 资源与**门控后的** sidecar.rs 分支；`.\build-desktop.ps1` 察元三档产物逐字节不变（§3.6 硬约束）。

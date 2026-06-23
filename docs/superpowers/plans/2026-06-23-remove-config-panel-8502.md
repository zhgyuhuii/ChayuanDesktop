# 移除 8502 配置面板(NiceGUI)服务 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 下线 8502 NiceGUI 配置面板服务并移除 nicegui 依赖,同时原地保留被 React 后台/核心服务复用的 config_panel 后端逻辑,零回归。

**Architecture:** 四阶段安全顺序 —— ①停止启动 8502(可逆,不删代码) → ②抽 C 类混合文件的后端 helper 到中性模块并改 import → ③删纯 UI 文件 + 接线清理 → ④移除 nicegui 依赖/打包条目。每阶段独立可验证、可提交。

**Tech Stack:** Python/FastAPI(chayuan-server)、Rust/Tauri(chayuan-client sidecar)、docker/nginx、poetry、PyInstaller。

**说明(对本计划的 TDD 调整):** 本任务是删除/重构,不新增业务行为。各任务的"测试"= `py_compile` + import 冒烟 + `grep 残留` + 既有单测,而非新写单测。这是该类工作的合规验证方式。

**仓库:** 单一 git 仓 `/work/chayuan-desktop`(root 所有,所有 git/写文件操作走 `sudo`;只 stage 改动文件,分支 main)。

**根目录速记:**
- SRV = `/work/chayuan-desktop/chayuan-server/libs/chayuan-server`
- CP = `chayuan/server/config_panel`(相对 SRV)
- py312 测试环境:免密 sudo + root conda py312(见 memory reference_py312_test_env)

---

## Phase 1 — 停止启动 8502(可逆,不删代码)

### Task 1: 桌面 sidecar 启动参数 -a → --api

**Files:**
- Modify: `chayuan-client/apps/desktop/src-tauri/src/sidecar.rs`
- Modify: `chayuan-client/apps/desktop/src-tauri/capabilities/default.json`
- Modify: `chayuan-client/apps/desktop/src-tauri/gen/schemas/capabilities.json`

- [ ] **Step 1: 改 sidecar.rs**
  把 `.args(["start", "-a", "--single-machine"])` 改为 `.args(["start", "--api", "--single-machine"])`(约 sidecar.rs:360)。同文件注释里 `chayuan start -a` 字样改 `chayuan start --api`(约 :24, :313)。

- [ ] **Step 2: 改 capabilities/default.json**
  `"args": ["start", "-a", "--single-machine"]` → `"args": ["start", "--api", "--single-machine"]`(约 :64)。

- [ ] **Step 3: 改 gen/schemas/capabilities.json**
  同步把 `"args":["start","-a","--single-machine"]` → `"args":["start","--api","--single-machine"]`。

- [ ] **Step 4: 验证**
  Run: `grep -rn '"-a"' chayuan-client/apps/desktop/src-tauri/` → 期望 0 命中(start 相关)。
  Run: `cargo check --manifest-path chayuan-client/apps/desktop/src-tauri/Cargo.toml`(真机若无 rust toolchain 可延后,记录跳过)。

- [ ] **Step 5: 提交**
  `sudo git add chayuan-client/apps/desktop/src-tauri/src/sidecar.rs chayuan-client/apps/desktop/src-tauri/capabilities/default.json chayuan-client/apps/desktop/src-tauri/gen/schemas/capabilities.json`
  `sudo git commit -m "refactor(desktop): sidecar 启动 --api 取代 -a,不再拉起 8502 面板"`

### Task 2: startup.py 移除 config 子进程 spawn

**Files:**
- Modify: `SRV/chayuan/startup.py`

- [ ] **Step 1: 删 config 子进程 spawn 块**
  删除 `config_started = manager.Event()` 起、到 `processes["config"] = process` 止的整段(约 :712-727,`if getattr(args, "config", False):` 块)。

- [ ] **Step 2: 删 args.all→config**
  把 `if args.all:` 块里的 `args.config = True` 删除,只保留 `args.api = True`(约 :660-662)。

- [ ] **Step 3: 删 config 子进程的等待/注册/banner**
  删 `_wait_child_started("配置面板", ...)`(约 :786)、`register_child` 中 config 分支与 `("config", int(p.pid...), _port_of("CONFIG_SERVER", 8502), ...)`(约 :784)、banner 里 `察元AI助手配置面板:` / `配置面板登录 URL` 两行(约 :576-577)、`("配置面板", dict(getattr(bs,"CONFIG_SERVER",{})...))`(约 :1018)。`run_config_panel` 函数本体暂留(Phase 3 删)。

- [ ] **Step 4: 验证**
  Run: `cd SRV && python -m py_compile chayuan/startup.py` → 期望无错。
  Run: `grep -n 'processes\["config"\]\|args.config = True' chayuan/startup.py` → 0 命中。

- [ ] **Step 5: 提交**
  `sudo git add chayuan-server/libs/chayuan-server/chayuan/startup.py`
  `sudo git commit -m "refactor(server): startup 不再 spawn 8502 config 子进程"`

### Task 3: cli.py 移除 -c/--config,-a 退化为仅 API

**Files:**
- Modify: `SRV/chayuan/startup.py`(cli main + click options 在此文件 :1100-1140)

- [ ] **Step 1: 删 -c/--config option**
  删除 `@click.option("-c","--config","config", is_flag=True, ...)` 整段(约 :1117-1123)。

- [ ] **Step 2: 改 main 签名与 args**
  `def main(all, api, config, single_machine):` → `def main(all, api, single_machine):`;删 `args.config = config`(约 :1136);`-a/--all` 的 help 文案 `"同时启动 API 与配置面板"` 改 `"启动 API 服务(等同 --api)"`。

- [ ] **Step 3: 删 config-only 启动支线**
  删除 startup 里"仅 `-c`(只启动配置面板)"跳过 DB 初始化的整段逻辑(约 :1191-1220 注释块及其 `if args.config and not args.api:` 分支),以及 :587 `cfg_url = ... if getattr(args,"config",False)` 等死分支。

- [ ] **Step 4: 验证**
  Run: `cd SRV && python -m py_compile chayuan/startup.py`。
  Run: `cd SRV && python -c "from chayuan.startup import main"` → 无 import 错。
  Run: `grep -n '"--config"\|args.config' chayuan/startup.py` → 0 命中。

- [ ] **Step 5: 提交**
  `sudo git commit -am "refactor(server): cli 移除 -c/--config,-a 等同 --api"`(注:`-am` 仅当无其它脏文件;否则显式 add startup.py)

### Task 4: docker / nginx 移除 8502

**Files:**
- Modify: `docker/nginx.conf`
- Modify: `docker/docker-compose.yaml`
- Modify: `docker/docker-compose.single.yaml`
- Modify: `docker/entrypoint.sh`

- [ ] **Step 1: nginx.conf**
  删 `server 127.0.0.1:8502;` upstream 行(:46,若该 upstream 块只此一行则删整个 `upstream` 块)与 `# 3. config panel (NiceGUI) 反代到 :8502` 的 `location` 反代块(:90 起)。

- [ ] **Step 2: docker-compose.yaml**
  删 `- "8502:8502"` 端口映射(:205)与头部注释里 `+ 配置面板(:8502)` / `面板 :8502` / `8502 面板` 字样(:5, :17, :18)。

- [ ] **Step 3: docker-compose.single.yaml**
  删 `- "8502:8502"` 映射(:59)与上方注释(:54)。

- [ ] **Step 4: entrypoint.sh**
  若启动行用 `chayuan start -a`,改 `--api`(以脚本实际为准;`grep -n 'start' docker/entrypoint.sh` 定位)。

- [ ] **Step 5: 验证**
  Run: `grep -rn '8502' docker/` → 0 命中。
  Run: `docker run --rm -v "$PWD/docker/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t`(若本机有 docker;否则记录跳过,真机验)。

- [ ] **Step 6: 提交**
  `sudo git add docker/nginx.conf docker/docker-compose.yaml docker/docker-compose.single.yaml docker/entrypoint.sh`
  `sudo git commit -m "refactor(docker): 移除 8502 面板端口映射与 nginx 反代"`

---

## Phase 2 — 抽 C 类后端 helper 到中性模块

> 通用方法(每个文件同款):①新建中性模块,从原文件**剪切**所列公开符号 + 它们 transitively 依赖的私有 helper(以 py_compile + import 冒烟反复补齐缺名);②新模块**禁止** import `nicegui` / `_safe_ui`;③把外部 import 方的路径改到新模块;④原文件暂留(Phase 3 整删)。

### Task 5: 抽 runtime_framework_panel 后端 helper → runtime_framework.py

**Files:**
- Create: `SRV/CP/runtime_framework.py`
- Modify: `SRV/CP/runtime_framework_panel.py`(剪掉被抽符号,留 UI)
- Modify: `SRV/chayuan/server/capability_router.py`
- Modify: `SRV/chayuan/server/model_registry/auto_assign.py`
- Modify: `SRV/chayuan/server/model_registry/process_args.py`
- Modify: `SRV/chayuan/server/api_server/services_config_routes.py`
- Modify: `SRV/chayuan/server/api_server/image_routes.py`
- Modify: `SRV/chayuan/server/api_server/admin_routes.py`

被外部 import 的符号(全集):
`_load_capability_defaults`, `_save_capability_default`, `_docker_compose_ps`, `probe_all_frameworks`, `CAPABILITY_LABELS`, `_CAP_TO_YAML_KEY`, `_CAP_TO_GROUP_KEY`。

- [ ] **Step 1: 建 runtime_framework.py 并迁移符号**
  在 `CP/runtime_framework.py` 写模块 docstring,从 `runtime_framework_panel.py` 把上列 7 个符号及其私有依赖剪过来。新文件顶部 import 仅限后端依赖(yaml_store、settings、subprocess 等),不得 import nicegui/_safe_ui。

- [ ] **Step 2: 原文件改为转发(过渡)**
  在 `runtime_framework_panel.py` 顶部加 `from chayuan.server.config_panel.runtime_framework import (上列7符号)`,保证其内部 UI 代码仍能引用(该文件 Phase 3 删)。

- [ ] **Step 3: 改 6 个外部 import 方路径**
  把 `from chayuan.server.config_panel.runtime_framework_panel import (...)` 全部改成 `from chayuan.server.config_panel.runtime_framework import (...)`:
  - capability_router.py:60(`_load_capability_defaults`)、:104(`_save_capability_default`)
  - model_registry/auto_assign.py:83(`_load_capability_defaults, _save_capability_default`)
  - model_registry/process_args.py:79(`_load_capability_defaults`)
  - api_server/services_config_routes.py:46(`probe_all_frameworks`)
  - api_server/image_routes.py:683(`_docker_compose_ps`)
  - api_server/admin_routes.py:931(`CAPABILITY_LABELS,_CAP_TO_YAML_KEY,_CAP_TO_GROUP_KEY,_load_capability_defaults,_save_capability_default`)、:1047(`_save_capability_default`)

- [ ] **Step 4: 验证**
  Run: `cd SRV && python -m py_compile chayuan/server/config_panel/runtime_framework.py`。
  Run: `cd SRV && python -c "from chayuan.server.config_panel.runtime_framework import _load_capability_defaults,_save_capability_default,_docker_compose_ps,probe_all_frameworks,CAPABILITY_LABELS,_CAP_TO_YAML_KEY,_CAP_TO_GROUP_KEY; print('ok')"` → 打印 ok(缺名则回 Step 1 补迁)。
  Run: `cd SRV && python -c "import sys,chayuan.server.config_panel.runtime_framework as m; assert 'nicegui' not in sys.modules, 'nicegui 被拉起'"` → 无断言错。
  Run: `cd SRV && python -c "import chayuan.server.capability_router, chayuan.server.model_registry.auto_assign, chayuan.server.model_registry.process_args"` → 无错。

- [ ] **Step 5: 提交**
  `sudo git add` 上述 8 文件;`sudo git commit -m "refactor(server): 抽 runtime_framework 后端 helper 出 NiceGUI panel"`

### Task 6: 抽 model_config 后端符号 → model_providers.py

**Files:**
- Create: `SRV/CP/model_providers.py`
- Modify: `SRV/CP/model_config.py`(剪符号,留 UI)
- Modify: `SRV/chayuan/server/utils.py`
- Modify: `SRV/chayuan/server/api_server/openai_routes.py`
- Modify: `SRV/chayuan/server/api_server/admin_routes.py`

被外部 import 的符号:`_PROVIDER_BY_ID`, `PROVIDER_CATALOG`, `model_metadata_seed_for`。

- [ ] **Step 1: 建 model_providers.py 并迁移**
  从 `model_config.py` 把 `PROVIDER_CATALOG`(provider 数据表)、`_PROVIDER_BY_ID`(其派生索引)、`model_metadata_seed_for`(及私有依赖)剪到 `CP/model_providers.py`。新文件不得 import nicegui/_safe_ui。

- [ ] **Step 2: 原文件加转发**
  `model_config.py` 顶部加 `from chayuan.server.config_panel.model_providers import PROVIDER_CATALOG,_PROVIDER_BY_ID,model_metadata_seed_for`(供其残留 UI 引用;Phase 3 删)。

- [ ] **Step 3: 改外部 import 方**
  - server/utils.py:226, :269(`_PROVIDER_BY_ID`)→ model_providers
  - api_server/openai_routes.py:254(`PROVIDER_CATALOG`)→ model_providers
  - api_server/admin_routes.py:336(`PROVIDER_CATALOG, model_metadata_seed_for`)、:672、:741(`_PROVIDER_BY_ID`)→ model_providers

- [ ] **Step 4: 验证**
  Run: `cd SRV && python -m py_compile chayuan/server/config_panel/model_providers.py`。
  Run: `cd SRV && python -c "from chayuan.server.config_panel.model_providers import PROVIDER_CATALOG,_PROVIDER_BY_ID,model_metadata_seed_for; print(len(PROVIDER_CATALOG))"` → 打印数字。
  Run: `cd SRV && python -c "import sys,chayuan.server.config_panel.model_providers; assert 'nicegui' not in sys.modules"`。
  Run: `cd SRV && python -c "import chayuan.server.utils, chayuan.server.api_server.openai_routes"` → 无错。

- [ ] **Step 5: 提交**
  `sudo git commit -am "refactor(server): 抽 model_providers 出 NiceGUI model_config"`(显式 add 五文件)

### Task 7: 抽 dashboard / service_page 单符号 helper

**Files:**
- Modify: `SRV/CP/yaml_store.py`(收 `_upsert_export_line`)
- Modify: `SRV/CP/service_checks.py`(收 `build_snapshot`)
- Modify: `SRV/CP/dashboard.py`、`SRV/CP/service_page.py`(留转发)
- Modify: `SRV/chayuan/server/api_server/datadir_routes.py`
- Modify: `SRV/chayuan/server/api_server/services_config_routes.py`

- [ ] **Step 1: 迁 `_upsert_export_line`**
  从 `dashboard.py` 把 `_upsert_export_line` 及其私有依赖剪到 `yaml_store.py`。

- [ ] **Step 2: 迁 `build_snapshot`**
  从 `service_page.py` 把 `build_snapshot` 及其私有依赖剪到 `service_checks.py`(确认 service_checks 不含 nicegui)。

- [ ] **Step 3: 改 import 方**
  - datadir_routes.py:65 `from ...dashboard import _upsert_export_line` → `from ...yaml_store import _upsert_export_line`
  - services_config_routes.py:150 `from ...service_page import build_snapshot` → `from ...service_checks import build_snapshot`

- [ ] **Step 4: 验证**
  Run: `cd SRV && python -c "from chayuan.server.config_panel.yaml_store import _upsert_export_line; from chayuan.server.config_panel.service_checks import build_snapshot; print('ok')"`。
  Run: `cd SRV && python -c "import chayuan.server.api_server.datadir_routes, chayuan.server.api_server.services_config_routes"` → 无错。

- [ ] **Step 5: 提交**
  `sudo git commit -m "refactor(server): 抽 dashboard/service_page helper 到 yaml_store/service_checks"`(显式 add 六文件)

---

## Phase 3 — 删纯 UI + 接线清理

### Task 8: 删纯 UI(A 类)+ C 类原文件 + __init__ run_config_panel

**Files(删除):**
- `SRV/CP/app.py`、`auto_register.py`、`_safe_ui.py`、`_guidance_card.py`、`captcha.py`、`install_dialog.py`、`provider_hero_strip.py`、`container_health_strip.py`、`image_model_panel.py`、`mirror_source_panel.py`、`restart_helper.py`、`monitoring.py`
- `SRV/CP/apps_page.py`、`tools_page.py`、`users_page.py`、`mcp_manage_page.py`、`kb_manage_page.py`、`kb_acl_page.py`、`custom_tools_page.py`、`performance_page.py`、`websocket_endpoints_page.py`、`service_config_page.py`
- C 类原文件:`SRV/CP/model_config.py`、`runtime_framework_panel.py`、`dashboard.py`、`service_page.py`
**Files(改):**
- `SRV/CP/__init__.py`

- [ ] **Step 1: 删除前真 import 校验**
  Run(对每个待删模块名 NAME): `cd SRV && grep -rn "config_panel.*\bNAME\b\|config_panel import .*\bNAME\b" --include="*.py" chayuan/ | grep -v "config_panel/"` —— 只允许命中注释/docstring(无 `import`/`from` 语句行)。Phase 2 已迁的 4 个 C 文件此时应只剩 docstring 引用。任一出现真 import 则停,回 Phase 2 处理。

- [ ] **Step 2: git rm 删除**
  `cd /work/chayuan-desktop && sudo git rm` 上列所有路径(含 4 个 C 原文件)。

- [ ] **Step 3: 清理 __init__.py**
  删 `__init__.py` 里 `run_config_panel` 的定义/导出及对 `app`/UI 模块的 import;保留对 B 类共享模块的导出。

- [ ] **Step 4: 清理 B 类残留 lazy import**
  Run: `cd SRV && grep -rn "from \.\|config_panel" chayuan/server/config_panel/*.py | grep -E "app|auto_register|_safe_ui|_page|dashboard|model_config|runtime_framework_panel|service_page|provider_hero_strip|container_health_strip|install_dialog|image_model_panel|mirror_source_panel|restart_helper|monitoring|captcha|_guidance_card"` —— 命中处删除该悬空 import 分支/行。

- [ ] **Step 5: 验证**
  Run: `cd SRV && python -c "import chayuan.server.config_panel"` → 无 import 错。
  Run: `cd SRV && for f in chayuan/server/config_panel/*.py; do python -m py_compile "$f" || echo "FAIL $f"; done` → 无 FAIL。
  Run: `cd SRV && grep -rn "from nicegui\|import nicegui" chayuan/server/config_panel/` → 0 命中。
  Run: `cd SRV && python -c "import sys; import chayuan.server.config_panel; assert 'nicegui' not in sys.modules, sys.modules.get('nicegui')"` → 无断言错。

- [ ] **Step 6: 提交**
  `sudo git commit -m "refactor(server): 删除 config_panel NiceGUI UI 与 run_config_panel"`

### Task 9: 删 run_config_panel 函数 + 8502 端口/地址接线

**Files:**
- Modify: `SRV/chayuan/startup.py`(删 `run_config_panel` 函数本体 :439-479)
- Modify: `SRV/chayuan/settings.py`(删 `CONFIG_SERVER` 字段 :303 + `"config_panel": 8502` :329)
- Modify: `SRV/chayuan/server/utils.py`(删 `config_panel_address` :1265、`config_panel_login_url` :1277)
- Modify: `SRV/chayuan/server/runtime/port_allocator.py`(去 CONFIG_SERVER 分配)
- Modify: `SRV/chayuan/server/runtime/__init__.py` 或 `bootstrap.py`(`allocate_core_ports`/`render_endpoints_table` 去 config 端口)
- Modify: `SRV/chayuan/cli_admin.py`(删 `status config`、`update port`、面板地址打印;:27-28 import 去掉)
- Modify: `SRV/chayuan/tray/common.py`(删 8502 端口 + `config_panel_url`)
- Modify: `SRV/chayuan/init_wizard.py`(删 `_DEFAULT_PORT=8502`、面板 URL 打印、`config_panel.out.log`)
- Modify: `SRV/chayuan/webui.py`(清死 8502 跳转链接文案)

- [ ] **Step 1: startup.py 删 run_config_panel 函数**
  删 `def run_config_panel(...)` 整个函数体(约 :439-479);删 startup.py 顶部/内部对 `server.utils.config_panel_address/login_url` 的 import 与残用。

- [ ] **Step 2: settings.py / utils.py / port_allocator 去端口**
  按 Files 所列逐处删除。`server/utils.py` 删两个面板地址函数;确认无其它调用(`grep -rn config_panel_address\|config_panel_login_url chayuan/`)。

- [ ] **Step 3: cli_admin.py**
  删 `from ...server.utils import config_panel_address, config_panel_login_url`(:27-28);`status` 命令去掉 config 行与 8502 端口默认;删 `update port` 子命令(:266 起);删面板地址 echo(:122, :140, :317)。`config_panel.auth` import 保留不动。

- [ ] **Step 4: tray/common.py + init_wizard.py + webui.py**
  按 Files 所列删 8502 引用;webui.py 仅改注释/死链文案,不动逻辑。

- [ ] **Step 5: 验证**
  Run: `cd SRV && grep -rn "8502\|CONFIG_SERVER\|run_config_panel\|config_panel_address\|config_panel_login_url" chayuan/ --include=*.py` → 0 命中。
  Run: `cd SRV && python -m py_compile chayuan/startup.py chayuan/settings.py chayuan/server/utils.py chayuan/cli_admin.py chayuan/tray/common.py chayuan/init_wizard.py chayuan/webui.py chayuan/server/runtime/port_allocator.py`。
  Run: `cd SRV && python -c "from chayuan.cli import cli"` 或等价 `python -c "import chayuan.startup, chayuan.cli_admin"` → 无错。

- [ ] **Step 6: 提交**
  `sudo git commit -m "refactor(server): 清除 8502 端口/地址/run_config_panel 接线"`(显式 add 上列文件)

### Task 10: 测试清理

**Files:**
- Delete: `SRV/tests/unit_tests/test_config_panel_api_gate.py`
- Modify: `SRV/tests/unit_tests/test_stop_command.py`

- [ ] **Step 1: 删 api_gate 测试**
  `cd /work/chayuan-desktop && sudo git rm chayuan-server/libs/chayuan-server/tests/unit_tests/test_config_panel_api_gate.py`。
  (注:`config_panel/api_gate.py` 模块本身若 Task 8 后无人 import,可一并 git rm;先 `grep -rn api_gate chayuan/ --include=*.py` 确认。)

- [ ] **Step 2: 改 test_stop_command.py**
  Run: `cd SRV && grep -n "8502\|config" tests/unit_tests/test_stop_command.py` 定位;删除针对 config 子进程的断言/夹具,保留 API/stop 主断言。

- [ ] **Step 3: 验证**
  Run: `cd SRV && PYTHONPATH="$PWD" python -m pytest -q tests/unit_tests/test_stop_command.py` → 期望 PASS(py312 env)。

- [ ] **Step 4: 提交**
  `sudo git commit -m "test(server): 移除 8502 config 面板相关断言"`

---

## Phase 4 — 移除 nicegui 依赖与打包条目

### Task 11: pyproject + poetry.lock 去 nicegui

**Files:**
- Modify: `SRV/pyproject.toml`(删 :198 `nicegui = ">=1.4.20,<2.0"`)
- Modify: `SRV/poetry.lock`(由 poetry 重生)

- [ ] **Step 1: 删 pyproject 声明**
  删 `pyproject.toml` 中 `nicegui = ">=1.4.20,<2.0"` 行。

- [ ] **Step 2: 重生 lock**
  Run(py312 env): `cd SRV && poetry lock --no-update`。
  Run: `cd SRV && grep -c 'name = "nicegui"' poetry.lock` → 期望 0(若仍有,说明别的包依赖它,记录并停下评估)。

- [ ] **Step 3: 验证 import 期无 nicegui**
  Run: `cd SRV && python -c "import sys; import chayuan.server.config_panel; import chayuan.startup; assert 'nicegui' not in sys.modules, sys.modules.get('nicegui')"`。

- [ ] **Step 4: 提交**
  `sudo git add chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/poetry.lock`
  `sudo git commit -m "build(server): 移除 nicegui 依赖"`

### Task 12: PyInstaller spec + mac build 去 nicegui

**Files:**
- Modify: `chayuan-server/packaging/pyinstaller/chayuan-server.spec`
- Modify: `chayuan-server/packaging/mac/build_mac.sh`

- [ ] **Step 1: spec 去 nicegui**
  Run: `grep -n nicegui chayuan-server/packaging/pyinstaller/chayuan-server.spec` 定位;删 `collect_data_files('nicegui')` / hiddenimports 中 nicegui / datas 中 nicegui 条目。

- [ ] **Step 2: build_mac.sh 去 nicegui**
  Run: `grep -n nicegui chayuan-server/packaging/mac/build_mac.sh` 定位并删除。

- [ ] **Step 3: 验证**
  Run: `grep -rn nicegui chayuan-server/packaging/` → 0 命中。
  Run: `python -m py_compile chayuan-server/packaging/pyinstaller/chayuan-server.spec`(spec 是 py 文件)。
  真机 PyInstaller 构建验证延后到发版构建(memory: desktop build 走 build.py --offline)。

- [ ] **Step 4: 提交**
  `sudo git commit -m "build(packaging): spec/mac 去除 nicegui 收集"`(显式 add 两文件)

### Task 13: 全仓终检 + 版本 bump

**Files:**
- Modify: `VERSION` 等 6 个版本文件(2.0.x → +1)

- [ ] **Step 1: 全仓残留终检**
  Run: `cd /work/chayuan-desktop && grep -rn "8502\|run_config_panel\|from nicegui\|import nicegui" --include=*.py --include=*.json --include=*.conf --include=*.yaml --include=*.sh --include=*.rs . | grep -vE "node_modules|/dist/|\.git/|docs/superpowers"` → 仅允许 docs/spec 命中。

- [ ] **Step 2: 后端冒烟**
  Run(py312 env): `cd SRV && PYTHONPATH="$PWD" python -m pytest -q tests/unit_tests/test_kb_query_schemas.py tests/unit_tests/test_kb_query_service.py` → PASS。
  Run: `cd SRV && python -c "import chayuan.server.api_server.admin_routes, chayuan.server.api_server.openai_routes, chayuan.server.api_server.services_config_routes, chayuan.server.api_server.datadir_routes, chayuan.server.api_server.image_routes"` → 无错。

- [ ] **Step 3: 前端 typecheck**
  Run: `cd chayuan-client && pnpm --filter @chayuan/app typecheck` → 无错(本任务未改前端 TS,作回归保险)。

- [ ] **Step 4: 版本 bump**
  6 文件(VERSION、pyproject.toml、chayuan/__init__.py、apps/{publisher,desktop,installer}/src-tauri/tauri.conf.json)2.0.x → +1。

- [ ] **Step 5: 提交**
  `sudo git commit -m "chore: bump version(移除 8502 面板)"`(显式 add 6 版本文件)

---

## 自查与遗留

- 真机验证延后项(需构建机):`cargo check` src-tauri、PyInstaller nicegui 移除后的桌面/docker 实包构建、nginx -t、docker compose 起容器。完成代码后明确告知用户这些待真机验。
- 若 Step(Task 11/Step 2)发现别的包传递依赖 nicegui,停下评估,不强删。
- C 类抽取(Task 5/6)是最高风险;每步 import 冒烟必须绿后再进下一步。

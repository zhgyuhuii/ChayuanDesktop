# 移除 8502 配置面板(NiceGUI)服务 — 设计

- 日期:2026-06-23
- 状态:已通过设计评审,待写实施计划
- 背景:后台已从 NiceGUI(8502)逐域迁移到 React 后台(`/admin`,共用 AdminPage + admin JWT)。
  React 后台已达 parity,8502 NiceGUI 服务可整体下线。本设计描述如何**外科手术式**
  地移除 8502 服务与 NiceGUI 依赖,同时**不破坏**仍在复用 `config_panel` 包内后端逻辑的
  React API 路由 / 核心服务 / CLI / startup。

## 目标

1. 不再启动 8502 NiceGUI 配置面板(桌面单机 + docker 网络版)。
2. 删除纯 NiceGUI UI 代码,清理 8502 启动/端口/反代/打包接线。
3. 移除 `nicegui` 依赖(pyproject + poetry.lock + PyInstaller spec)。
4. **保留**被外部复用的后端逻辑模块,零回归。

## 非目标

- 不重构 React 后台。
- 不动老的 Streamlit `webui.py` / `webui_pages/`(独立遗留面,不用 nicegui、不被启动),
  仅顺手清理其中死的 8502 跳转链接。
- 不迁移 `config_panel/` 包整体路径(保留共享模块原地,包名沿用)。

## 关键约束(为什么不能直接删 config_panel 目录)

`config_panel` 是后端共享逻辑的事实归属地。~30 个**外部**文件(api_server 路由 / startup /
cli / image embedder / DH engine / capability_router / auth / tools runtime 等)import 它的
非 UI 模块。盲删整个目录会同时打断 React 后台和核心服务。因此采用**保留共享模块 + 只删
UI 与接线**的策略。

`config_panel` 内 nicegui 的 import 全部是 **lazy(函数内、UI 代码路径)**,模块级 import
共享模块不会拉起 nicegui —— 这是「保留模块同时移除 nicegui 依赖」可行的前提。

## 文件分类

### A. 纯 UI — 直接删(约 30+ 文件)

NiceGUI 渲染 / 注册 / UI 辅助文件:`app.py`、`auto_register.py`、`_safe_ui.py`、
`_guidance_card.py`、`captcha.py`、`install_dialog.py`、`provider_hero_strip.py`、
`container_health_strip.py`、`image_model_panel.py`、`mirror_source_panel.py`、
`restart_helper.py`、`monitoring.py`,以及纯 UI 的 `*_page.py`:`apps_page`、`tools_page`、
`users_page`、`mcp_manage_page`、`kb_manage_page`、`kb_acl_page`、`custom_tools_page`、
`performance_page`、`websocket_endpoints_page`、`service_config_page`。

> 说明:`kb_acl_page`/`custom_tools_page`/`performance_page` 被外部文件 docstring 以「港自/
> 镜像」字样提及,但**不是真 import**(对应后端能力已另存于 `server/api_server/*`、
> `server/admin/metrics.py`、`server/tools/custom_tool_test.py`),可安全删除。删除前对每个
> 文件再跑一次「真 import」校验(AST,排除注释/docstring)确认无存活引用。

`__init__.py`:保留文件本身(共享模块的包入口),但删除 `run_config_panel` 导出及其 UI 引用。

### B. 共享后端逻辑 — 原地保留(~22 文件)

`yaml_store`、`restart`、`install_task_manager`、`install_recipes`、`apps_store`、
`custom_tools_store`、`websocket_endpoints_store`、`db_config`、`vs_config`、`redis_config`、
`storage_config`、`schema`、`auth`、`health`、`bootstrap`、`stop`、`init_assets`、
`external_runtimes`、`infinity_inventory`、`local_infinity_pip`、`local_service_catalog`、
`local_service_detector`、`compose_manager`、`compose_sources`、`container_lifecycle`、
`mirror_pool`、`service_checks`、`api_gate`、`scalability`(后端部分)。

这些被 CLI/startup/React 路由/核心服务 import,**不动**。删 UI 后需复跑一次依赖闭包,
确认它们不再 import 任何已删的 A 类模块(若有 lazy import 指向 UI,一并删除该分支)。

### C. 混合文件 — 抽 helper 到中性模块再删原文件(4 个)

每个文件留有被存活代码真 import 的后端 helper,其余是 lazy-nicegui 渲染函数。处理:把 helper
抽到新的中性模块,改外部 import,再整删原 UI 文件。

| 原文件 | 抽出的 helper | 现有外部 import 方 | 建议新归属 |
|---|---|---|---|
| `model_config.py` | `_PROVIDER_BY_ID`(及其构建逻辑) | `server/utils.py` | `server/config_panel/model_providers.py`(新,纯数据) |
| `runtime_framework_panel.py` | 被框架选择用的后端函数 | `capability_router.py`、`model_registry/process_args.py`、`model_registry/auto_assign.py` | `server/config_panel/runtime_framework.py`(新,纯逻辑) |
| `dashboard.py` | `_upsert_export_line` | `api_server/datadir_routes.py` | 并入 `server/config_panel/yaml_store.py` 或新 `dashboard_helpers.py` |
| `service_page.py` | `build_snapshot` | `api_server/services_config_routes.py` | 并入 `service_checks.py` 或新 `service_snapshot.py` |

> 实施时先逐文件确认 helper 的真实符号清单(grep 外部 import 的具体名字),抽取后保持函数签名
> 不变,只改 import 路径。新中性模块**不得** import nicegui / _safe_ui。

## 8502 接线移除(config_panel 之外)

### chayuan-server

- `startup.py`:删 `run_config_panel()`;删 `target=run_config_panel` 的 mp 子进程 spawn、
  `config_started` event、`register_child("config", ...)`、`record_runtime` 的 config 分支、
  banner 中面板地址/登录 URL 行、`args.all → args.config = True`、config-only(`-c`)启动支线
  (跳过 DB 初始化那段)。`-a/--all` 退化为等同 `--api`(保证桌面 `start -a` 仍起 API)。
- `cli.py`:删 `-c/--config` option;`-a/--all` 帮助文案与语义改为「仅 API」;删 config-only 路径。
- `settings.py`:删 `CONFIG_SERVER` 字段 + 端口映射里的 `"config_panel": 8502`。
- `server/utils.py`:删 `config_panel_address()`、`config_panel_login_url()`;更新 `_PROVIDER_BY_ID`
  的 import 指向新 `model_providers`。
- `server/runtime/port_allocator.py` 与 `allocate_core_ports` / `render_endpoints_table`:去掉
  CONFIG_SERVER 端口分配与展示。
- `cli_admin.py`:`status` 去掉 config 项、删 `update port` 命令、删面板地址打印;`auth` import
  保持(`config_panel/auth.py` 保留)。
- `tray/common.py`:删 8502 端口 / `config_panel_url()`。
- `init_wizard.py`:删 `_DEFAULT_PORT = 8502`、面板登录 URL 打印、`config_panel.out.log` 引用。
- `webui.py`:仅清理死的 8502 跳转链接文案(不重构)。
- 测试:删 `tests/unit_tests/test_config_panel_api_gate.py`;`test_stop_command.py` 去掉 config
  子进程相关断言。

### chayuan-client(桌面)

- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/gen/schemas/capabilities.json`
- `apps/desktop/src-tauri/src/sidecar.rs`

  三处把 sidecar 参数 `["start","-a","--single-machine"]` → `["start","--api","--single-machine"]`。

### docker

- `docker/nginx.conf`:删 `server 127.0.0.1:8502;` upstream 与 config panel `location` 反代块。
- `docker/docker-compose.yaml` / `docker/docker-compose.single.yaml`:删 `8502:8502` 端口映射 +
  头部注释里的面板说明。
- `docker/entrypoint.sh`:若用 `start -a`,改 `--api`(以实际脚本为准)。

### 打包

- `packaging/pyinstaller/chayuan-server.spec`:删 nicegui 的 `collect_*` / `hiddenimports` / datas。
- `packaging/mac/build_mac.sh`:删 nicegui 相关收集。
- `pyproject.toml`:删 `nicegui = ">=1.4.20,<2.0"`;`poetry lock` 重生 lock。

## 验证

1. `python -m py_compile` 所有改动 .py。
2. py312 env:server 单测(KB query / 权限 / 启动);
   `python -c "import sys, chayuan.server.config_panel; assert 'nicegui' not in sys.modules"`。
3. 全仓 grep 无残留:`8502`、`run_config_panel`、`from nicegui` / `import nicegui`、
   `config_panel.<已删模块>`。
4. `poetry lock` 后 lock 内无 nicegui。
5. 客户端 `pnpm --filter @chayuan/app typecheck`;`cargo check`(src-tauri)。真机重建延后。
6. C 类抽取后逐个验证 import 方(server/utils、capability_router、auto_assign、process_args、
   datadir_routes、services_config_routes)仍可 import 且行为不变。

## 风险

- **C 类 helper 抽取**:从 1900/2100 行大文件抽函数易误删依赖。缓解:抽取后保持签名不变、
  逐 import 方验证、py_compile + 单测兜底。
- **lazy import 残留**:保留的 B 类模块里可能有指向已删 A 类 UI 的 lazy import 分支。
  缓解:删 UI 后复跑依赖闭包 grep,清理悬空 import。
- **桌面 sidecar 参数**:`-a`→`--api` 改错会导致 sidecar 起不来。缓解:确认 `--api` 单独可
  正常启动 API(startup 决策分支)。
- **poetry.lock 重生**:需 py312 env;真机打包验证(PyInstaller nicegui 移除)延后到构建时。

## 规模

删约 35 文件、改约 18 文件(server + client + docker + packaging)、抽 4 处 helper、重生
poetry.lock。建议分阶段执行(见实施计划)。

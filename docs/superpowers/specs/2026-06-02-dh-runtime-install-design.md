# 应用内一键安装/启动数字人 GPU 运行时(SadTalker + MuseTalk)

- 日期:2026-06-02
- 状态:已通过 brainstorming,待用户复审
- 影响项目:`chayuan-server`(HTTP 路由)、`chayuan-client`(API 客户端 + 新页面)

## 1. 背景与问题

数字人生成面板里 `SadTalker · 高清头动(GPU)` / `MuseTalk · 高清口型(GPU)` 显示「未安装」,旁边「去模型厂商配置」按钮 navigate 到 `/marketplace`。但:

- `_engine_installed("sadtalker")` 判定依据是 **`_port_listening(18680)`** —— 即「sidecar 在不在跑」,**不反映模型下没下**。
- `/marketplace` 只管 LLM/Embedding **厂商 API 配置**,**没有数字人引擎条目**;`installGuides/data.ts` 也无 DH。
- 真正能装/起 DH 运行时的入口在**后端 NiceGUI 管理面板**(`runtime_framework_panel`),**前端 React 应用够不到**;后端有 `install_task_manager` 能力但**没暴露 HTTP 路由**。

结果:点「去模型厂商配置」是**死路**——进了模型广场也找不到 SadTalker/MuseTalk。

## 2. 目标

1. 新建前端「数字人运行时」页,列 SadTalker + MuseTalk 两张卡:状态 + 安装源选择 + 一键安装(带进度日志)+ 启动/停止。
2. 「去模型厂商配置」按钮改指这个新页。
3. 后端新建**通用** `framework_routes.py`,薄封装现有 `install_task_manager` + `_FRAMEWORK_CATALOG` + `install_recipes`,暴露 install/start/stop/status/task 路由(天然覆盖全部运行时框架,前端 DH 页只过滤 `talking-head`)。

## 3. 非目标

- 不重写安装/启停业务逻辑(全复用现有 `install_task_manager` / `install_recipes` / catalog)。
- MuseTalk **不做全自动**:`install_kind="manual"`,只做到 git clone(官方/ghproxy);权重 `download_weights` + 推理环境仍需用户手动,卡片明确标注。
- 不改 `_engine_installed`(生成面板的端口探活)语义;新页给全貌,生成面板按钮只改跳转目标。
- SSE 流式日志推送留作后续优化,本期用轮询。
- 模型显式 prefetch(带进度)留作后续;SadTalker 模型靠 full 包自带(已实现)或首次推理自动拉。

## 4. 关键事实(探索已确认)

- 后端业务逻辑**基本现成**(给 NiceGUI 后台用):
  - `config_panel/install_task_manager.py`:`InstallTaskManager.start(framework, recipe)` / `start_service(framework)` / `stop_service(framework)` / `get(task_id)` / `attach(framework)` / `list_active()` / `cancel(task_id)`;`InstallTask.to_dict()` 含 `state`(pending/running/done/failed/cancelled)+ `log`(环形 500 行)+ `return_code` + `error`。
  - `config_panel/install_recipes.py`:`get_recipes(framework)` 返回 `List[InstallRecipe{label,cmd,note,requires}]`。SadTalker = 4 条 pip 镜像源(modelscope);MuseTalk = 2 条 git clone(官方 + ghproxy)。
  - `config_panel/runtime_framework_panel.py`:`_FRAMEWORK_CATALOG` 含 sadtalker(`install_kind="pip"`,`needs_gpu=True`,`default_url=...18680`,`health_path="/health"`)、musetalk(`install_kind="manual"`,`needs_gpu=True`,`...18780`)。
  - GPU 检测:`chayuan-preflight/.../gpu_checks.py` + `runtime.pytorch_installer.detect_status()`。
- **缺口**:① 通用 framework HTTP 路由(`api_server/` 下完全没有);② 前端 `packages/api` framework 客户端方法;③ 前端页面。
- 前端 DH 客户端:`chayuan-client/packages/api/src/digitalHuman.ts`(`dhListEngines` 模式 `rd<T>('/api/v1/...')`)。

## 5. 设计

### 5.1 后端通用路由(`framework_routes.py`,薄)

新文件 `chayuan-server/libs/chayuan-server/chayuan/server/api_server/framework_routes.py`,只做协议适配 + 调现有 manager/catalog/recipes(不放业务逻辑):

| 路由 | 方法 | 实现 | 返回 |
|---|---|---|---|
| `/api/v1/framework` | GET | 遍历 `_FRAMEWORK_CATALOG` + `get_recipes(name)` | `{items:[{name,label,capabilities,needs_gpu,install_kind,url,recipes:[{label,note,requires}]}]}` |
| `/api/v1/framework/{name}/status` | GET | catalog 查 spec + health ping(`default_url`+`health_path`)+ GPU 检测 | `{name,installed,running,url,needs_gpu,gpu:{vendor,name}}` |
| `/api/v1/framework/{name}/install` | POST `{recipe_label}` | 按 label 在 `get_recipes(name)` 选配方 → `manager.start(framework,recipe)` | `{task_id}` |
| `/api/v1/framework/{name}/task/{task_id}` | GET | `manager.get(task_id).to_dict()` | InstallTask dict(state+log+return_code+error) |
| `/api/v1/framework/{name}/start` | POST | `manager.start_service(framework)` | `{task_id}` 或 `{state}` |
| `/api/v1/framework/{name}/stop` | POST | `manager.stop_service(framework)` | `{state}` |

- `installed` 判定:pip 类 = `install_pkg` 可 import;manual 类(MuseTalk)= 仓目录(`~/MuseTalk`)存在;有 `bin_names` = PATH 上能找到。封装一个 `_framework_installed(spec)` 纯函数(从 `runtime_framework_panel.probe_*` 解耦最小逻辑,或直接轻量实现)。
- `running` 判定:health ping(复用现有 port/health 探活)。
- 路由文件只做参数校验 + 调用,业务全在 config_panel 模块;在 `api_server` 注册该 router。

### 5.2 前端 API 客户端

新文件 `chayuan-client/packages/api/src/runtimeFramework.ts`(或并入 digitalHuman.ts),沿用 `rd<T>` 模式:
- `frameworkList()` / `frameworkStatus(name)` / `frameworkInstall(name, recipeLabel)` / `frameworkTask(name, taskId)` / `frameworkStart(name)` / `frameworkStop(name)`。
- 类型:`FrameworkSpec`、`FrameworkStatus`、`InstallTask`(state/log/...)。

### 5.3 前端页面 `/digital-human/runtime`

- 新路由组件 `features/digital-human/RuntimePage.tsx`(命名/样式跟现有 DH 组件一致)。
- 卡片(SadTalker、MuseTalk 各一,数据来自 `frameworkList()` 过滤 `capabilities` 含 `talking-head`):
  - 状态徽标:`未安装` / `已安装·未启动` / `运行中`(由 `frameworkStatus` 的 installed+running 推导)。
  - GPU 提示:`needs_gpu` 时显示检测结果;无 GPU → 警告文案但**不禁用**按钮。
  - 安装源下拉:`recipes`(SadTalker 选 pip 镜像;MuseTalk 选 git 源)。
  - 「安装」按钮 → `frameworkInstall` 拿 task_id → 轮询 `frameworkTask` 显示日志面板(state/log,终态停轮询)。
  - 「启动」/「停止」按钮 → `frameworkStart`/`frameworkStop`,之后轮询 status 刷新徽标。
  - MuseTalk 卡片额外固定提示:「clone 后需按官方 README 跑 download_weights 拉权重并配推理环境,本页只完成 clone」。
- `GeneratePanel.tsx:539` 的「去模型厂商配置」`navigate({to:'/marketplace'})` 改为 `navigate({to:'/digital-human/runtime'})`,文案改为「去安装运行时」。

### 5.4 数据流(SadTalker 为例)

```
点「安装」(选 pip·清华源)
 → POST /framework/sadtalker/install {recipe_label}
 → manager.start(sadtalker, recipe) 起线程跑 pip → 返 task_id
 → 前端轮询 GET /framework/sadtalker/task/{id} → 显示 log,state=done
点「启动」
 → POST /framework/sadtalker/start → start_service → nohup sidecar:18680
 → 轮询 GET /framework/sadtalker/status → health ping 通 → running=true → 徽标「运行中」
 → 回生成面板,engineInstalled(端口探活)变 true,不再「未安装」
```

## 6. 错误处理

- 安装失败:task `state=failed` + `error` + `log`,前端日志面板红色展示 stderr,提示换安装源(镜像)。
- 启动超时:status `running=false`,提示看日志(`/tmp/chayuan_sadtalker.log`)。
- MuseTalk clone 成功但未配权重:status `installed=true`(仓在)但启动后 health 不通 → 提示「需先 download_weights」。
- 无 GPU 仍点安装:允许;若启动后推理失败由 sidecar 报错链路反馈。
- 路由 404/未知 framework:400 + 可用列表。

## 7. 测试计划

- 后端单测 `test_framework_routes.py`:`GET /framework` 列表含 sadtalker/musetalk;`status` 返回结构;`install` 触发 `manager.start`(monkeypatch manager,断言按 recipe_label 选对配方);`task` 透传 `to_dict`;未知 framework → 400。
- 前端:`npm run typecheck`;客户端方法类型一致。
- `[GPU-VERIFY]`:真装真起 SadTalker/MuseTalk + 推理需用户 GPU 机器实测。

## 8. 风险

- `install_task_manager` 是进程内单例 + 线程跑 subprocess;在 sidecar 进程内触发 pip/git clone 会改运行环境,需确保不阻塞事件循环(start 已是后台线程)。
- 暴露 install/start 给前端 = 任意 app 用户可在 host 跑 pip/git/起进程;桌面单用户场景可接受,**不要**在多租户服务端部署开放该 router(加部署开关/鉴权,后续)。
- MuseTalk 一键体验不完整(仅 clone),需文案管理用户预期。
- `probe_framework` 当前耦合 NiceGUI logging,解耦需小心不破坏后台面板。

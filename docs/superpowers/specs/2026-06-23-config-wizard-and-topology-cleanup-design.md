# 服务状态页清理 + 首启配置向导 + 配置生效闭环 — 设计

- 日期:2026-06-23
- 范围:`chayuan-client`(后台 React)+ `chayuan-server`(基础设施配置/拓扑/profile)
- 约束:**只动网络版(web)分支,不破坏单机版(desktop)逻辑**;后端复用现有 save 路由,前端复用现有配置组件,不另造阉割版表单(守 CLAUDE.md「真复用」红线)。

## 背景与现状

网络版后台「服务状态」页(`ServiceTopologyPage.tsx` + 后端 `config_panel/service_page.py`)以 SVG 拓扑呈现节点:client / nginx / api / **panel(配置面板服务)** / redis / db / milvus / minio / langfuse + 动态运行时节点。点击节点弹出一个手写 `z-[500]` 弹窗,内嵌对应配置页。

基础设施连接保存到 `basic_settings.yaml` / `kb_settings.yaml`,**均在启动期被缓存**(DB 引擎、redis 客户端、storage 工厂、向量库服务),改了要重启 `chayuan-server` 才生效。存在静默回退坑:缺 DB 驱动 → 静默回退 sqlite;`CHAYUAN_PROFILE` 非空(single-machine)→ 启动期把配置覆盖回 sqlite。单机版由 `apply_single_machine()` 强制改写这些值,是「不破坏单机版」的边界。

后台左侧存在三处可配置基础设施的入口:① 拓扑节点点击弹窗 ② 独立的「基础设施」菜单组(`AdminPage.tsx`:基础配置/数据库/Redis/对象存储/数据目录)③(本设计新增)配置向导。

## 用户诉求(四点 + 向导)

1. 拓扑移除冗余节点(「配置面板服务」)。
2. nginx 节点要点亮,且它本就无可配置项。
3. 点击节点保存后,「已保存」提示框被配置弹窗遮挡 —— 全节点通病。
4. 配置后服务要**真正使用**这些配置(如业务数据库配后,一切入库都走它)。
5. 管理员登录后第一件事进入**配置向导**:① 业务数据库 ② Redis ③ 对象存储 ④ 向量库 ⑤ 基础模型(先配厂商→再选默认模型)……每步可跳过;向导可重复打开;完成后进入服务状态(性能)页。基础设施里很多可选项可隐藏,节点上已能配的地方不再重复配。

## 已定决策(brainstorming)

1. **配置入口收敛**:节点弹窗与向导**并存**,二者编辑同一份后端配置,复用同一批组件;独立的「基础设施」左侧菜单组**收起**(组件保留,仅撤出导航)。三处配置面 → 收敛为「拓扑 + 向导」两个引导面。
2. **配置生效**:能热更的热更(redis/对象存储/向量库重置缓存客户端即时生效)+ DB 走「需重启」横幅 + **一键重启(进程自重启)** + 重启后回探确认;并堵静默回退、保存时强制校验真连通。
3. **向导触发**:仅网络版;管理员登录时若无「完成」标记则自动弹;每步可跳过;走完(含全跳过)置完成标记不再自动弹;按钮可随时重开(重开预填现状);完成后落到服务状态页。`is_single_machine()` 为真则**永不弹**。
4. **模型步骤**:先配置模型厂商(API Key/本地)→ 再选默认模型(embedding/rerank/chat)。

## A. 拓扑页清理(Issues 1/2/3)

### A1 — 移除「配置面板服务」节点
后端 `config_panel/service_page.py`:删除 `panel` 节点定义,及其关联边 `("nginx","panel")`、`("panel","db")`。前端无需改(节点列表由后端快照驱动)。

### A2 — nginx 点亮且不可配置
- 后端 `_probe_nginx()` 语义改为「能取到本页/反代可达即 `ok`」,避免误判 down/unknown。
- nginx 节点 `config_kind=""`,新增字段 `configurable: bool`(nginx=false;client/api 等纯展示节点同样 false)。
- 前端 `TopologyNode` 类型加 `configurable`;对 `configurable=false` 的节点:状态卡**不显示「配置」按钮**,点击只弹只读状态/诊断弹窗(**不再回退到 `ServicesConfigPage`**)。

### A3 — 修「已保存」提示被遮挡(全节点通病)
根因:节点配置弹窗是手写 `fixed ... z-[500]` div,而全局 toast(`ErrorDialog` → Radix `Dialog`)默认 z 低于它,被盖在后面。
修法:把全局 `ErrorDialogRoot` 的 overlay/content z 提升到所有手写弹窗之上(`z-[1000]` 量级,统一一个 `--cy-z-toast` token)。一处修,节点弹窗/向导/AddCheckDialog 全部受益。校验:在节点弹窗内点保存,toast 盖在弹窗之上可见。

## B. 配置入口收敛(决策1)

- **保留两个引导入口**:拓扑节点点击 + 配置向导。
- 向导每一步与节点弹窗**复用同一批组件**:`DatabaseConfigPage / RedisConfigPage / StorageConfigPage / VectorStorePage` + 模型步骤(厂商接入复用「模型平台」相关页、默认模型复用「默认模型」页)。向导只在外层套**步骤外壳**(进度/上一步/下一步/跳过/完成),把当前步组件塞进 slot;不复制后端逻辑、不旁路 save 路由。
- **收起左侧「基础设施」菜单组**:`AdminPage.tsx` 的 `基础设施` group 从导航撤下(`hidden: true` 或移除该 group),`basic/database/redis/storage/datadir` 这些 tab 仍可经 URL / 拓扑节点 / 向导访问;可选项(Langfuse 等)默认隐藏。组件文件保留不删(被复用)。

## C. 配置生效闭环(Issue 4 / 决策2)— 核心

### C1 — 能热更的热更(保存即生效)
为三个缓存层各加一个 reset,保存成功后由对应 save 路由调用,下次取用即读新配置:
- `server/shared/__init__.py`:`get_redis()` 模块级缓存 → 新增 `reset_redis()`。
- `server/file_storage/factory.py`:`get_storage()` 工厂缓存 → 新增 `reset_storage()`。
- 向量库服务实例缓存 → 新增 `reset_vector_store()`(清 DEFAULT_VS_TYPE/kbs_config 派生的服务实例)。
对应路由:`redis_config_routes.save` / `storage_routes.switch_backend` / `vs_config_routes.save` 保存成功后调用 reset,并把响应 `restart_required` 置 `false`(已热更)。

### C2 — DB 走一键重启 + 回探确认
DB 引擎/SessionLocal 在 import 期建立,运行时重建风险高(在途 session / 连接池),不做热重建。
- `db_config_routes.save` 成功后仍返回 `restart_required: true`。
- 前端 DB 配置页/向导步:保存成功展示「需重启生效」横幅 + 「立即重启服务」按钮。
- 点重启 → 调 C4 自重启端点 → 前端轮询 `/api/v1/admin/db/status` 直到 `ok` 才标记该步「已生效」。

### C3 — 堵静默回退 + 保存即校验(「配后一切入库都用它」)
- **保存 DB 前强制 `/db/validate` 真连通**,失败直接拒绝写 yaml(不落坏配置)。
- 网络版下关掉「缺驱动 → 静默回退 sqlite」:`server/db/base.py` 的回退分支在网络版改为**显式抛错/标红**,提示安装驱动,绝不悄悄落 sqlite。(单机版分支不变。)
- **`CHAYUAN_PROFILE` 告警**:若检测到 profile 会在启动期把 DB 覆盖回 sqlite(single-machine),向导/保存时显式告警「当前 profile 会覆盖你的数据库配置,请确认网络版 profile 配置」——堵历史坑。

### C4 — 一键重启(进程自重启)
当前无重启端点。新增受保护端点(仅管理员、仅网络版):优雅关闭后退出进程,依赖容器编排 `restart: always` 拉起。
- 端点:`POST /api/v1/admin/services/restart`(鉴权:管理员;`is_single_machine()` 为真则拒绝)。
- 行为:返回 202 后,后台延时优雅退出(给响应回包留时间)→ 进程退出 → compose 重启。
- 兜底:若一定时间内未恢复(前端回探超时),提示「自动重启未完成,请手动重启 chayuan-server 容器」。

## D. 首启配置向导(决策3、4)

### D1 — 步骤清单
| # | 步骤 | 必需性 | 复用组件 | 生效 |
|---|---|---|---|---|
| 1 | 业务数据库 | 必需 | `DatabaseConfigPage` | C2/C3 重启 |
| 2 | Redis | 可选 | `RedisConfigPage` | C1 热更 |
| 3 | 对象存储 | 可选 | `StorageConfigPage` | C1 热更 |
| 4 | 向量库 | 必需 | `VectorStorePage` | C1 热更 |
| 5 | 模型厂商接入 | 必需 | 模型平台页 | 即时 |
| 6 | 默认模型选择 | 必需 | 默认模型页 | 即时 |

可选服务(Langfuse 链路追踪等)折叠进「高级」,默认隐藏;nginx 不入向导。每步可跳过。步骤间不互相阻塞,但必需步骤未配置时在「完成」页给出醒目提示(可仍选择完成)。

### D2 — 触发与完成(仅网络版)
- 门控:`is_single_machine()` 为真 → 向导与自动弹出逻辑**全部短路**,单机桌面零改动。
- 完成标记:新增 `wizard_completed`(存 config center / yaml,网络版命名空间)。
- 自动弹出:网络版管理员登录后,无 `wizard_completed` → 自动进向导;有 → 不弹。
- 完成/全跳过:走到最后一步点「完成」或「全部跳过」→ 置 `wizard_completed=true`,之后不再自动弹。
- 重开:后台放「重新配置向导」按钮(放在拓扑页 / 模型与服务组),随时可重开;重开时各步**预填现状**,已配的不强制重填。
- 完成后落到**服务状态(拓扑)页**。

### D3 — 数据流
向导每步 = 现有配置组件 + 步骤外壳;保存走各自现有 save 路由(已带 C1 热更 / C2 重启提示 / C3 校验);向导层不复制后端逻辑、不旁路。完成标记的读写经新增轻量端点 `GET/POST /api/v1/admin/wizard/state`。

## 受影响文件(预估)

### chayuan-server
- `config_panel/service_page.py` — 删 panel 节点+边;nginx probe 语义;节点加 `configurable`。
- `api_server/services_config_routes.py` — 拓扑响应带 `configurable`;新增 `POST .../services/restart`;新增 `GET/POST .../wizard/state`。
- `server/shared/__init__.py` — `reset_redis()`。
- `server/file_storage/factory.py` — `reset_storage()`。
- 向量库服务模块 — `reset_vector_store()`。
- `api_server/redis_config_routes.py` / `storage_routes.py` / `vs_config_routes.py` — 保存后 reset、`restart_required=false`。
- `api_server/db_config_routes.py` — 保存前强制 validate。
- `server/db/base.py` — 网络版禁静默回退 sqlite(单机分支不变)。

### chayuan-client
- `packages/api/src/infraConfig.ts` — `TopologyNode.configurable`;`servicesConfig.restart()`;`wizardState` get/set。
- `features/admin/services/ServiceTopologyPage.tsx` — `configurable=false` 不显示配置按钮、点击只读;复用组件不变。
- `features/shell/ErrorDialog.tsx` — toast z 提升至弹窗之上。
- `features/admin/AdminPage.tsx` — 收起「基础设施」菜单组;接入向导自动弹出门控 + 重开按钮。
- 新增 `features/admin/wizard/`(步骤外壳 + 编排;复用各配置组件)。

## 不做(YAGNI)
- 不做 DB 引擎运行时热重建(决策2:DB 走重启)。
- 不删任何配置组件文件(仅撤出菜单)。
- 不改单机桌面任何配置/启动逻辑。
- 不实现外部编排(K8s 等)重启,仅 compose `restart: always` 自重启 + 手动兜底。

## 风险
- **自重启依赖编排**:若部署未设 `restart: always`,自重启会让服务停掉 → 必须有「请手动重启」兜底文案,且在 PACKAGING/compose 文档注明该 restart 策略要求。
- **profile 覆盖**:网络版必须确保 `CHAYUAN_PROFILE` 非 single-machine,否则 DB 配置被启动期覆盖(C3 已加告警,但根治需部署侧 env 正确)。
- **向量库 reset 边界**:若存在跨请求持有的向量库句柄,reset 后旧句柄可能仍被引用 → reset 实现需保证下次取用走新实例,在途请求用旧实例完成即可。
- 后端 pytest 需 py312 环境(本机 root conda 可跑,见 memory `reference_py312_test_env`)。

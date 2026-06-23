# 配置向导 + 服务拓扑清理 + 配置生效闭环 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网络版后台清理服务拓扑、修保存提示遮挡、让基础设施配置保存即真正生效(热更/一键重启),并新增首启配置向导;全程不破坏单机版。

**Architecture:** 后端复用现有 save 路由,新增缓存 reset、自重启端点、向导状态端点、DB 校验/防静默回退;前端复用现有配置组件,新增向导步骤外壳、收起基础设施菜单、修 toast 层级、拓扑节点 `configurable` 门控。仅网络版生效(`is_single_machine()` 门控)。

**Tech Stack:** Python/FastAPI/Pydantic/SQLAlchemy(chayuan-server)、React/TypeScript/Zustand/Radix(chayuan-client)。

**仓库约定(重要):**
- 工作根 `/work/chayuan-desktop`,该仓 **root 所有**,所有写文件/`git` 操作需 `sudo`;提交分支 `main → origin/main`,只 stage 本计划改动文件(仓库有 3142 个 mode-bit 噪音,勿 `git add -A`)。
- 后端 pytest 用 py312(root conda)。命令模板:
  `sudo -E env PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" <py312-python> -m pytest -q <test>`
  (执行者先确认 py312 解释器路径,见 memory `reference_py312_test_env`;下文用占位 `PYTEST` 代表该完整前缀。)
- 前端在 `/work/chayuan-desktop/chayuan-client`:`npm run typecheck`;targeted eslint 触达文件。
- 每个 commit message 末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## 阶段 A — 拓扑清理 + toast 遮挡修复(独立可发)

### Task A1: 后端删除「配置面板服务」节点

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/config_panel/service_page.py`(`panel` 节点定义约 580-588 行;edges 约 657-667 行)
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_service_topology.py`(新建)

- [ ] **Step 1: 写失败测试**

```python
# test_service_topology.py
from chayuan.server.config_panel import service_page

def test_panel_node_removed():
    topo = service_page.build_snapshot(probe=False)
    ids = {n["id"] if isinstance(n, dict) else n.sid for n in topo["nodes"]}
    assert "panel" not in ids

def test_no_edge_touches_panel():
    topo = service_page.build_snapshot(probe=False)
    edges = topo["edges"]
    assert all("panel" not in (a, b) for a, b in edges)
```

(若 `build_snapshot` 返回 dataclass 而非 dict,执行者按实际返回结构取 `nodes/edges`;先读该函数确认序列化形态再定断言取值方式。)

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTEST chayuan-server/libs/chayuan-server/tests/unit_tests/test_service_topology.py -v`
Expected: FAIL(panel 仍在)

- [ ] **Step 3: 删除 panel 节点 + 关联边**

删除 `service_page.py` 中 `panel` 的 `ServiceSnapshot(...)` 定义块,以及 edges 列表里的 `("nginx", "panel")`、`("panel", "db")` 两项。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2 → Expected: PASS

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/config_panel/service_page.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_service_topology.py
sudo git commit -m "fix(topology): 移除配置面板服务节点及关联边"
```

### Task A2: 后端 nginx 点亮 + 节点 `configurable` 字段

**Files:**
- Modify: `service_page.py`(`_probe_nginx` 约 341-349;`ServiceSnapshot` dataclass 约 53-74;各节点定义)
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/services_config_routes.py`(topology 序列化约 137-170,加 `configurable`)
- Test: `test_service_topology.py`(追加)

- [ ] **Step 1: 追加失败测试**

```python
def test_nginx_configurable_false_and_ok_when_reachable(monkeypatch):
    # nginx 探活恒真时应为 ok 且不可配置
    monkeypatch.setattr(service_page, "_probe_nginx", lambda *a, **k: ("ok", "reverse proxy", ""))
    topo = service_page.build_snapshot(probe=True)
    n = next(x for x in topo["nodes"] if (x["id"] if isinstance(x, dict) else x.sid) == "nginx")
    get = (lambda k: n[k]) if isinstance(n, dict) else (lambda k: getattr(n, k))
    assert get("status") == "ok"
    assert get("configurable") is False

def test_infra_nodes_configurable_true():
    topo = service_page.build_snapshot(probe=False)
    for sid in ("db", "redis", "milvus", "minio"):
        n = next(x for x in topo["nodes"] if (x["id"] if isinstance(x, dict) else x.sid) == sid)
        get = (lambda k: n[k]) if isinstance(n, dict) else (lambda k: getattr(n, k))
        assert get("configurable") is True
```

(执行者据 `_probe_nginx` 实际返回签名调整 monkeypatch 形态。)

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTEST .../test_service_topology.py -v` → Expected: FAIL(无 `configurable`)

- [ ] **Step 3: 实现**

1. `ServiceSnapshot` dataclass 增字段 `configurable: bool = False`。
2. 给 `db/redis/milvus/minio/langfuse` 节点定义传 `configurable=True`;`client/nginx/api` 传 `configurable=False`(api 虽 restartable 但无连接配置面)。
3. `_probe_nginx`:改为「反代可达即 ok」——优先对本机回环 / 已知 nginx 健康路径 GET,2xx/3xx/即便 404 但 TCP 连通也视为 `ok`(说明 nginx 在跑);完全连不上才 `down`。保持函数签名不变。
4. `services_config_routes.py` topology 响应:在每个 node dict 里加 `"configurable": bool(svc.configurable)`。

- [ ] **Step 4: 跑测试确认通过** → Expected: PASS

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/config_panel/service_page.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/services_config_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_service_topology.py
sudo git commit -m "feat(topology): nginx 反代可达即点亮 + 节点 configurable 字段"
```

### Task A3: 前端拓扑消费 `configurable` + toast 层级修复

**Files:**
- Modify: `chayuan-client/packages/api/src/infraConfig.ts`(`TopologyNode` 加 `configurable: boolean`)
- Modify: `chayuan-client/packages/app/src/features/admin/services/ServiceTopologyPage.tsx`(状态卡配置按钮门控 + 节点点击只读)
- Modify: `chayuan-client/packages/app/src/features/shell/ErrorDialog.tsx`(提升 toast z)

- [ ] **Step 1: 类型加字段**

`infraConfig.ts` 的 `interface TopologyNode` 增 `configurable: boolean;`。

- [ ] **Step 2: 状态卡 + 点击门控**

`ServiceTopologyPage.tsx`:
- 状态卡里「配置」按钮仅在 `n.configurable` 时渲染。
- 弹窗:`configFor` 仅对 `n.configurable` 节点用 `CONFIG_COMPONENT`;否则渲染只读状态弹窗(展示 `label/summary/detail/status`,无表单)。
- 删除 `DEFAULT_CONFIG` 回退到 `ServicesConfigPage` 的路径(不可配节点不再误弹服务配置页)。

- [ ] **Step 3: toast 提升到所有手写弹窗之上**

`ErrorDialog.tsx`:给 `DialogContent`(及其 overlay,若 `@chayuan/ui` 暴露 `DialogOverlay`/className 注入)加 `z-[1000]`(高于拓扑/向导手写弹窗的 `z-[500]`)。若 Radix `DialogContent` 不直接接受层级 className,改为给 `@chayuan/ui` 的 Dialog overlay 设置 `--cy-z-toast`(=1000)并在此处引用。最小改动优先:`<DialogContent className="z-[1000] max-w-md">` + 确认对应 overlay 同步抬高。

- [ ] **Step 4: typecheck + 视觉验证**

Run(在 `chayuan-client`):`npm run typecheck`
手测:网络版后台打开拓扑 → 点 db 节点 → 改→保存 → 「已保存」toast 盖在配置弹窗**之上**可见;点 nginx 节点 → 无「配置」按钮、只读弹窗。

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-client/packages/api/src/infraConfig.ts chayuan-client/packages/app/src/features/admin/services/ServiceTopologyPage.tsx chayuan-client/packages/app/src/features/shell/ErrorDialog.tsx
sudo git commit -m "fix(admin): 拓扑不可配节点只读 + 保存提示不再被弹窗遮挡"
```

---

## 阶段 C — 配置生效闭环(核心)

### Task C1: 缓存 reset 函数 + 接入 save 路由(redis/storage/vector)

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/shared/__init__.py`(`get_redis` globals `_CLIENT/_PROBED/_DISABLED_REASON`)
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/file_storage/factory.py`(`get_storage` 缓存)
- Modify: 向量库服务工厂模块(执行者按 `vs_config_routes.py` 引用定位实例缓存所在)
- Modify: `redis_config_routes.py` / `storage_routes.py` / `vs_config_routes.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_infra_cache_reset.py`(新建)

- [ ] **Step 1: 写失败测试**

```python
# test_infra_cache_reset.py
from chayuan.server import shared

def test_reset_redis_clears_singleton():
    shared._CLIENT = object()
    shared._PROBED = True
    shared._DISABLED_REASON = "stale"
    shared.reset_redis()
    assert shared._CLIENT is None
    assert shared._PROBED is False
    assert shared._DISABLED_REASON in (None, "")

def test_reset_storage_recreates_instance():
    from chayuan.server.file_storage import factory
    factory.reset_storage()  # 不抛即可;下次 get_storage 重读配置
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTEST .../test_infra_cache_reset.py -v` → Expected: FAIL(`reset_redis` 未定义)

- [ ] **Step 3: 实现 reset**

- `shared/__init__.py` 增:
```python
def reset_redis() -> None:
    """清空进程内 redis 单例,使下次 get_redis() 重读 REDIS_URL。"""
    global _CLIENT, _PROBED, _DISABLED_REASON
    try:
        if _CLIENT is not None:
            # 关闭旧连接池(异步客户端的关闭交由 GC;此处仅丢引用)
            pass
    finally:
        _CLIENT = None
        _PROBED = False
        _DISABLED_REASON = None
```
- `file_storage/factory.py` 增 `reset_storage()`:把模块级缓存实例(执行者读文件确认变量名,如 `_STORAGE`)置 `None`,下次 `get_storage()` 重建。
- 向量库工厂:增 `reset_vector_store()`,清掉按 KB/类型缓存的服务实例字典(执行者据实际缓存结构实现:`_CACHE.clear()` 或置空)。

- [ ] **Step 4: 接入 save 路由**

- `redis_config_routes.save`:写 yaml 成功后 `from chayuan.server import shared; shared.reset_redis()`,响应 `restart_required` 改 `False`。
- `storage_routes.switch_backend`:成功后 `reset_storage()`,响应标记已热更。
- `vs_config_routes.save`:成功后 `reset_vector_store()`,响应 `restart_required=False`。

- [ ] **Step 5: 跑测试确认通过** → Expected: PASS

- [ ] **Step 6: Commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/shared/__init__.py chayuan-server/libs/chayuan-server/chayuan/server/file_storage/factory.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/redis_config_routes.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/storage_routes.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/vs_config_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_infra_cache_reset.py
# 向量库工厂文件按实际路径补 add
sudo git commit -m "feat(infra): redis/对象存储/向量库 保存即热更(重置缓存客户端)"
```

### Task C2: DB 保存强制校验 + 网络版禁静默回退 + profile 告警

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/db_config_routes.py`(`save` 约 117-120)
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/db/base.py`(回退分支约 129-145)
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_db_config_guard.py`(新建)

- [ ] **Step 1: 写失败测试**

```python
# test_db_config_guard.py
import pytest
from chayuan.server.api_server import db_config_routes

def test_save_rejects_when_validation_fails(monkeypatch):
    monkeypatch.setattr(db_config_routes, "_validate_conn",
                        lambda form: {"ok": False, "error": "auth failed"})
    with pytest.raises(Exception):
        db_config_routes._save_impl({"SQLALCHEMY_DATABASE_URI": "postgresql://bad"})
```

(执行者据 `db_config_routes.py` 实际函数名/结构对齐:把 save 逻辑抽到可测的 `_save_impl`,校验函数名按现有 `validate` 路由复用;若已内联校验,测试改为断言 save 在校验失败时返回非 0 code 且未调用 `yaml_store.save_updates`。)

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现**

- `db_config_routes.save`:写 yaml **前**强制调用现有连通校验(同 `/db/validate` 逻辑),失败则返回错误 code、不写 yaml。
- `db/base.py` 回退分支:用 `from chayuan.server.profiles.bootstrap import is_single_machine`;当 `not is_single_machine()` 且用户配置非 sqlite 但驱动缺失时,**显式 raise / 启动失败并打醒目日志**(不再静默 `_create_sqlite_engine()`);单机版(`is_single_machine()` 真)保持原回退不变。
- profile 告警:`db_config_routes.save` 成功响应里附 `profile_warning: bool`——当 `is_single_machine()` 为真(说明 `CHAYUAN_PROFILE` 会启动期覆盖回 sqlite)时置真,前端据此提示。

- [ ] **Step 4: 跑测试确认通过** → Expected: PASS

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/db_config_routes.py chayuan-server/libs/chayuan-server/chayuan/server/db/base.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_db_config_guard.py
sudo git commit -m "fix(db): 保存前强制校验 + 网络版禁静默回退sqlite + profile覆盖告警"
```

### Task C3: 一键重启端点(进程自重启)

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/services_config_routes.py`(新增路由)
- Modify: `chayuan-client/packages/api/src/infraConfig.ts`(`servicesConfig.restart`)
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_restart_endpoint.py`(新建)

- [ ] **Step 1: 写失败测试**

```python
# test_restart_endpoint.py
import pytest
from chayuan.server.api_server import services_config_routes as scr

def test_restart_blocked_in_single_machine(monkeypatch):
    monkeypatch.setattr(scr, "is_single_machine", lambda: True)
    resp = scr._restart_impl()  # 单机拒绝
    assert resp["code"] != 0

def test_restart_schedules_exit_in_network(monkeypatch):
    monkeypatch.setattr(scr, "is_single_machine", lambda: False)
    called = {}
    monkeypatch.setattr(scr, "_schedule_graceful_exit", lambda delay: called.setdefault("d", delay))
    resp = scr._restart_impl()
    assert resp["code"] == 0
    assert "d" in called
```

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现**

- 在 `services_config_routes.py` 增 `from chayuan.server.profiles.bootstrap import is_single_machine`。
- `_schedule_graceful_exit(delay: float)`:起一个后台线程,`time.sleep(delay)` 后 `os._exit(0)`(或先发 SIGTERM 给自身触发优雅关闭);默认 `delay=1.0` 留响应回包时间。
- `_restart_impl()`:`is_single_machine()` 真 → 返回 `{"code":1,"msg":"单机版不支持远程重启"}`;否则调度退出并返回 `{"code":0,"msg":"重启已触发"}`。
- 新增受保护路由 `POST /api/v1/admin/services/restart`(沿用本文件其它 admin 路由的鉴权依赖),body 无需参数,调用 `_restart_impl()` 返回 202/JSON。
- `infraConfig.ts` 的 `servicesConfig` 增:`restart: () => http.post<{ msg: string }>('/api/v1/admin/services/restart')`。

- [ ] **Step 4: 跑测试确认通过** → Expected: PASS

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/services_config_routes.py chayuan-client/packages/api/src/infraConfig.ts chayuan-server/libs/chayuan-server/tests/unit_tests/test_restart_endpoint.py
sudo git commit -m "feat(services): 管理员一键重启端点(进程自重启,单机拒绝)"
```

### Task C4: 前端 DB 保存「需重启 + 一键重启 + 回探」横幅

**Files:**
- Modify: `chayuan-client/packages/app/src/features/admin/infra/DatabaseConfigPage.tsx`(`doSave` 约 98-116)

- [ ] **Step 1: 实现重启横幅**

`DatabaseConfigPage.tsx`:保存成功且响应 `restart_required` 时,显示横幅:「数据库配置已保存,需重启服务后生效」+「立即重启」按钮 + (若 `profile_warning`)红字「当前部署 profile 会在重启时覆盖回 sqlite,请检查 CHAYUAN_PROFILE」。点「立即重启」→ `servicesConfig.restart()` → 轮询 `dbConfig.status()` 每 2s,直到 `status==='ok'` 显示「已生效」,超时(如 60s)显示「自动重启未完成,请手动重启 chayuan-server 容器」。

- [ ] **Step 2: typecheck**

Run(`chayuan-client`):`npm run typecheck` → Expected: 通过

- [ ] **Step 3: Commit**

```bash
sudo git add chayuan-client/packages/app/src/features/admin/infra/DatabaseConfigPage.tsx
sudo git commit -m "feat(admin): DB保存后需重启横幅+一键重启+回探确认"
```

---

## 阶段 D — 首启配置向导 + 阶段 B 菜单收敛

### Task D1: 后端向导状态端点

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/wizard_routes.py`
- Modify: 路由注册处(执行者定位 api_server 路由聚合文件,挂载 `wizard_routes`)
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_wizard_state.py`(新建)

- [ ] **Step 1: 写失败测试**

```python
# test_wizard_state.py
from chayuan.server.api_server import wizard_routes

def test_default_not_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard.json")
    assert wizard_routes._read_state()["completed"] is False

def test_set_completed_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard.json")
    wizard_routes._write_state({"completed": True})
    assert wizard_routes._read_state()["completed"] is True
```

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

`wizard_routes.py`:
- `_state_path()` → `CHAYUAN_ROOT / wizard_state.json`(网络版命名空间;复用 `Settings` 取 CHAYUAN_ROOT)。
- `_read_state()` → 读 json,缺失返回 `{"completed": False}`。
- `_write_state(d)` → 原子写 json。
- `GET /api/v1/admin/wizard/state` → `{"code":0,"data": _read_state()}`(`is_single_machine()` 真时直接返回 `{"completed": True}` 让前端不弹)。
- `POST /api/v1/admin/wizard/state` body `{completed: bool}` → 写入。
- 在路由聚合文件注册该 router(沿用 admin 鉴权依赖)。

- [ ] **Step 4: 跑测试确认通过** → Expected: PASS

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/wizard_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_wizard_state.py
# 路由注册文件按实际路径补 add
sudo git commit -m "feat(wizard): 向导完成状态读写端点(单机恒completed)"
```

### Task D2: 前端向导 API 客户端

**Files:**
- Create: `chayuan-client/packages/api/src/wizard.ts`
- Modify: `chayuan-client/packages/api/src/index.ts`(导出 `wizard`)

- [ ] **Step 1: 实现客户端**

```ts
// wizard.ts
import { http } from './http';
export interface WizardState { completed: boolean }
export const wizard = {
  state: () => http.get<WizardState>('/api/v1/admin/wizard/state'),
  setCompleted: (completed: boolean) =>
    http.post<WizardState>('/api/v1/admin/wizard/state', { completed }),
};
```

(执行者据现有 `infraConfig.ts` 的 import 形态对齐 `http` 引入路径。)

- [ ] **Step 2: 导出 + typecheck**

`index.ts` 增 `export * from './wizard';`;`npm run typecheck` 通过。

- [ ] **Step 3: Commit**

```bash
sudo git add chayuan-client/packages/api/src/wizard.ts chayuan-client/packages/api/src/index.ts
sudo git commit -m "feat(wizard): 前端向导状态 API 客户端"
```

### Task D3: 向导步骤外壳 + 编排(复用现有配置组件)

**Files:**
- Create: `chayuan-client/packages/app/src/features/admin/wizard/SetupWizard.tsx`(外壳:进度/上一步/下一步/跳过/完成)
- Create: `chayuan-client/packages/app/src/features/admin/wizard/steps.ts`(步骤清单:复用组件映射)

- [ ] **Step 1: 步骤清单**

```ts
// steps.ts
import { DatabaseConfigPage } from '../infra/DatabaseConfigPage';
import { RedisConfigPage } from '../infra/RedisConfigPage';
import { StorageConfigPage } from '../infra/StorageConfigPage';
import { VectorStorePage } from '../config/VectorStorePage';
// 模型厂商接入页 / 默认模型页:复用现有「模型平台」「默认模型」组件,执行者按实际导出名引入
import { PlatformsPage } from '...';   // 模型厂商接入
import { DefaultsPage } from '...';    // 默认模型选择

export interface WizardStep { key: string; title: string; required: boolean; Comp: React.FC; advanced?: boolean }
export const WIZARD_STEPS: WizardStep[] = [
  { key: 'db',       title: '业务数据库',   required: true,  Comp: DatabaseConfigPage },
  { key: 'redis',    title: 'Redis 缓存',   required: false, Comp: RedisConfigPage },
  { key: 'storage',  title: '对象存储',     required: false, Comp: StorageConfigPage },
  { key: 'vstore',   title: '向量库',       required: true,  Comp: VectorStorePage },
  { key: 'platforms',title: '模型厂商接入', required: true,  Comp: PlatformsPage },
  { key: 'defaults', title: '默认模型',     required: true,  Comp: DefaultsPage },
];
```

- [ ] **Step 2: 外壳组件**

`SetupWizard.tsx`(props `{ onClose: () => void; onFinish: () => void }`):
- 顶部步骤进度条(高亮当前步、标必需/可选)。
- 主体渲染 `WIZARD_STEPS[idx].Comp`(直接复用,不改这些组件)。
- 底部:「上一步」「跳过此步」「下一步」;最后一步显示「完成」。
- 「完成」/「全部跳过到底」→ 调 `wizard.setCompleted(true)` → `onFinish()`。
- 必需步骤未配置不阻塞前进,但完成页给醒目提示(可仍完成)。
- 整体外层用与拓扑弹窗一致的层级(`z-[500]`),toast 已在 A3 抬到其上。

- [ ] **Step 3: typecheck** → `npm run typecheck` 通过(先解决 PlatformsPage/DefaultsPage 实际导入)

- [ ] **Step 4: Commit**

```bash
sudo git add chayuan-client/packages/app/src/features/admin/wizard/
sudo git commit -m "feat(wizard): 配置向导步骤外壳+编排(复用现有配置组件)"
```

### Task D4: 向导门控接入 AdminPage + 收起基础设施菜单(阶段 B)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/admin/AdminPage.tsx`(菜单组约 44-89;挂载向导)

- [ ] **Step 1: 收起「基础设施」菜单组**

`ADMIN_GROUPS` 里 `title: '基础设施'` 的整组:把其 items 全部加 `hidden: true`(保留 URL/拓扑/向导可达),或移除该 group。保留组件文件不动。

- [ ] **Step 2: 自动弹出门控**

`AdminPage` 挂载时(仅网络版):`wizard.state()` → 若 `!completed` 自动渲染 `<SetupWizard onFinish={() => 跳转/聚焦 topology tab}/>`。`is_single_machine()` 在网络前端恒假/后端已恒返回 completed,单机不弹。完成后落到 `topology` tab。

- [ ] **Step 3: 重开按钮**

在「模型与服务」组或拓扑页头部加「重新配置向导」按钮 → 设 `showWizard=true` 手动打开(重开时各步组件自读现状预填,无需额外逻辑)。

- [ ] **Step 4: typecheck + 手测** → `npm run typecheck` 通过;网络版首登自动进向导、走完落拓扑页、按钮可重开;单机版不出现向导。

- [ ] **Step 5: Commit**

```bash
sudo git add chayuan-client/packages/app/src/features/admin/AdminPage.tsx
sudo git commit -m "feat(wizard): 首登自动进向导+可重开;收起基础设施菜单组"
```

---

## 收尾

- [ ] 后端整体最小回归:`PYTEST chayuan-server/libs/chayuan-server/tests/unit_tests/test_service_topology.py .../test_infra_cache_reset.py .../test_db_config_guard.py .../test_restart_endpoint.py .../test_wizard_state.py -q`
- [ ] 前端:`npm run typecheck`(chayuan-client)+ 触达文件 targeted eslint
- [ ] `sudo git status --short` 确认只改了计划内文件(忽略 mode-bit 噪音)
- [ ] 真机:重建 desktop sidecar / 重启网络版 chayuan-server 后验证(配置热更/DB 重启/向导自动弹)——提醒用户常测的是重建前旧版
- [ ] push:`sudo git push origin main`

## 自检覆盖(spec → task)
- A1 删 panel → Task A1;A2 nginx 点亮+不可配 → Task A2/A3;A3 toast 遮挡 → Task A3。
- B 收起基础设施菜单 → Task D4 Step1;入口复用组件 → Task D3。
- C1 热更 → C1;C2 DB 重启横幅 → C4;C3 防回退/校验/profile 告警 → C2;C4 自重启 → C3。
- D1 步骤 → D3;D2 触发/完成/重开/单机门控 → D1+D4;D3 数据流 → D3(复用 save 路由)。

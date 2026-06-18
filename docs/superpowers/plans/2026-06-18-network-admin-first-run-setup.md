# 网络版首启管理员设置向导 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网络版/Docker 首次访问且后端无 admin 时,弹全屏向导收 用户名+密码+实例标识,提交即建 admin 并自动登录。

**Architecture:** Approach A(专用 `/auth/setup` 端点 + 专用前端引导门 `AdminSetupGate`)+ 机制 1(无显式 `AUTH_DEFAULT_ADMIN_PASSWORD` 就不预建 admin)。触发信号 = "无 admin 账户"(`role=admin` 计数为 0),仅网络版(`isWeb()`)生效,单机桌面不变。

**Tech Stack:** 后端 FastAPI / SQLAlchemy / Pydantic(`chayuan-server`);前端 React / TS / Zustand(`chayuan-client`)。

**Spec:** `docs/superpowers/specs/2026-06-18-network-admin-first-run-setup-design.md`

## 仓库约定(每个 commit 步骤都遵守)
- 仓库 root 所有 → git 用 `sudo`;只 stage 改动文件(避开 mode-bit 噪音):`sudo git -c core.fileMode=false add <files>`。
- 每次 commit 前跑 `sudo /usr/bin/python3.11 scripts/bump-version.py`,把它改动的版本文件一并 stage(`VERSION`、3 个 `tauri.conf.json`、`chayuan/__init__.py`、`pyproject.toml`)。
- 分支 `main` → `sudo git push origin main`。
- 后端 pytest 需真机(本沙箱无 server 依赖);静态自检用 `sudo /usr/bin/python3.11 -m py_compile <file>`。前端用 `./node_modules/.bin/tsc -p <pkg>/tsconfig.json --noEmit`(在 `chayuan-client` 下)。

## File Structure
**后端(`chayuan-server/libs/chayuan-server/chayuan/server`)**
- Modify `auth/service.py` — 新增 `admin_exists()`;改 `bootstrap_default_admin()`。
- Create `auth/instance_meta.py` — 实例标识的原子 JSON 持久化(镜像 `license/store.py`)。
- Modify `api_server/auth_routes.py` — `/auth/config` 增字段 + 新 `POST /auth/setup`。
**前端(`chayuan-client`)**
- Modify `packages/api/src/endpoints.ts` — `AuthConfig` 增字段 + `auth.setupAdmin`。
- Modify `packages/app/src/store/loginModal.ts` — 增 `adminSetupRequired`。
- Create `packages/app/src/features/auth/AdminSetupGate.tsx` — 全屏设置门。
- Modify `packages/app/src/Shell.tsx` — 写入 store + 渲染门(web only)。
**测试**:`chayuan-server/libs/chayuan-server/tests/unit_tests/test_admin_setup.py`(新)。

---

### Task 1: 后端 — `admin_exists()` + bootstrap 改造

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/auth/service.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_admin_setup.py`

- [ ] **Step 1: 写失败测试**(DB-backed,清理后置)

```python
# tests/unit_tests/test_admin_setup.py
from __future__ import annotations
import pytest
from chayuan.server.auth import service as svc
from chayuan.server.db.session import session_scope
from chayuan.server.db.models.user_model import UserModel


@pytest.fixture(autouse=True)
def _clean_users():
    """每例前后清空 users 表,避免 DB-backed 测试互相污染。"""
    def _purge():
        with session_scope() as s:
            s.query(UserModel).delete()
    _purge(); yield; _purge()


def test_admin_exists_false_when_empty():
    assert svc.admin_exists() is False


def test_admin_exists_true_after_admin_created():
    svc.create_user("alice", "secret123", role="admin")
    assert svc.admin_exists() is True


def test_admin_exists_false_when_only_normal_user():
    svc.create_user("bob", "secret123", role="user")
    assert svc.admin_exists() is False
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'admin_exists'`

- [ ] **Step 3: 实现 `admin_exists()`**(加在 `service.py` 的 `list_users` 之后)

```python
def admin_exists() -> bool:
    """是否已存在任意 admin 账户(首启向导触发判据)。"""
    with session_scope() as s:
        return s.query(UserModel.id).filter(UserModel.role == "admin").first() is not None
```

- [ ] **Step 4: 改 `bootstrap_default_admin()`**(机制 1:无显式密码就不预建)

把现有函数体内"密码留空则随机生成"的分支改为直接返回 None:

```python
def bootstrap_default_admin() -> Optional[Tuple[str, str]]:
    """仅当显式配置了 AUTH_DEFAULT_ADMIN_PASSWORD 时预建 admin;否则不建,
    交给前端首启向导(POST /auth/setup)。返回 (username, password) 仅用于日志。"""
    from chayuan.settings import Settings

    with session_scope() as s:
        if s.query(UserModel.id).first() is not None:
            return None

    bs = Settings.basic_settings
    username = (getattr(bs, "AUTH_DEFAULT_ADMIN_USERNAME", "admin") or "admin").strip() or "admin"
    password = (getattr(bs, "AUTH_DEFAULT_ADMIN_PASSWORD", "") or "").strip()
    if not password:
        # 机制 1:不再随机生成 + 打日志;让首启向导来设
        logger.info("未配置 AUTH_DEFAULT_ADMIN_PASSWORD,跳过预建 admin,等待首启向导设置")
        return None
    try:
        create_user(username, password, role="admin")
        return username, password
    except ValueError as e:
        logger.warning("bootstrap admin failed: %s", e)
        return None
```

(删掉原 `import secrets` 行及随机生成逻辑。)

- [ ] **Step 5: 补 bootstrap 行为测试**

```python
from unittest.mock import MagicMock, patch

def test_bootstrap_skips_when_no_password():
    fake = MagicMock()
    fake.basic_settings.AUTH_DEFAULT_ADMIN_USERNAME = "admin"
    fake.basic_settings.AUTH_DEFAULT_ADMIN_PASSWORD = ""
    with patch("chayuan.settings.Settings", fake):
        assert svc.bootstrap_default_admin() is None
    assert svc.admin_exists() is False

def test_bootstrap_creates_when_password_set():
    fake = MagicMock()
    fake.basic_settings.AUTH_DEFAULT_ADMIN_USERNAME = "root"
    fake.basic_settings.AUTH_DEFAULT_ADMIN_PASSWORD = "explicit123"
    with patch("chayuan.settings.Settings", fake):
        out = svc.bootstrap_default_admin()
    assert out == ("root", "explicit123")
    assert svc.admin_exists() is True
```

- [ ] **Step 6: 跑测试确认通过**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py -v`
Expected: PASS(5 例)

- [ ] **Step 7: Commit**(按仓库约定)

```bash
sudo /usr/bin/python3.11 scripts/bump-version.py
sudo git -c core.fileMode=false add \
  chayuan-server/libs/chayuan-server/chayuan/server/auth/service.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_admin_setup.py \
  VERSION chayuan-client/apps/*/src-tauri/tauri.conf.json \
  chayuan-server/libs/chayuan-server/chayuan/__init__.py \
  chayuan-server/libs/chayuan-server/pyproject.toml
sudo git commit -m "feat(auth): admin_exists() + 机制1 bootstrap 不再无密码随机建 admin"
sudo git push origin main
```

---

### Task 2: 后端 — 实例标识持久化模块

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/auth/instance_meta.py`
- Test: 追加到 `tests/unit_tests/test_admin_setup.py`

- [ ] **Step 1: 写失败测试**

```python
def test_instance_name_roundtrip(tmp_path):
    from chayuan.server.auth import instance_meta as im
    assert im.get_instance_name(tmp_path) == ""
    im.set_instance_name(tmp_path, "  我的察元实例  ")
    assert im.get_instance_name(tmp_path) == "我的察元实例"  # strip 后
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py::test_instance_name_roundtrip -v`
Expected: FAIL — `ModuleNotFoundError: ... auth.instance_meta`

- [ ] **Step 3: 实现模块**(镜像 `license/store.py` 的原子写)

```python
"""实例标识(显示名)持久化:<chayuan_root>/instance_meta.json,tmp+rename 原子写。"""
from __future__ import annotations
import json
from pathlib import Path


def _path(root: Path) -> Path:
    return Path(root) / "instance_meta.json"


def get_instance_name(root: Path) -> str:
    try:
        data = json.loads(_path(root).read_text(encoding="utf-8"))
        return str(data.get("name") or "").strip()
    except (FileNotFoundError, ValueError, OSError):
        return ""


def set_instance_name(root: Path, name: str) -> None:
    name = (name or "").strip()
    p = _path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"name": name}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py::test_instance_name_roundtrip -v`
Expected: PASS

- [ ] **Step 5: Commit**(同 Task 1 的 ritual,文件换成 `auth/instance_meta.py` + 测试)

```bash
# bump-version + add(instance_meta.py + test + 版本文件)+ commit + push
sudo git commit -m "feat(auth): 实例标识原子 JSON 持久化 instance_meta"
```

---

### Task 3: 后端 — `/auth/config` 增字段 + `POST /auth/setup`

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/auth_routes.py`
- Test: 追加到 `tests/unit_tests/test_admin_setup.py`

- [ ] **Step 1: 写失败测试**(用 FastAPI TestClient)

```python
def _client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from chayuan.server.api_server.auth_routes import auth_router
    app = FastAPI(); app.include_router(auth_router)
    return TestClient(app)


def test_config_reports_setup_required_when_no_admin():
    c = _client()
    r = c.get("/auth/config")
    assert r.status_code == 200
    assert r.json()["admin_setup_required"] is True


def test_setup_creates_admin_and_logs_in():
    c = _client()
    r = c.post("/auth/setup", json={"username": "owner", "password": "secret123", "instance_name": "实例A"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["user"]["role"] == "admin"
    assert svc.admin_exists() is True
    # 二次设置应被拒
    r2 = c.post("/auth/setup", json={"username": "x", "password": "secret123"})
    assert r2.status_code == 409
    # config 现在应报 false
    assert c.get("/auth/config").json()["admin_setup_required"] is False
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py -v -k "config_reports or setup_creates"`
Expected: FAIL — `admin_setup_required` KeyError / `/auth/setup` 404

- [ ] **Step 3: `/auth/config` 增字段**

把 `auth_config()` 的返回 dict 改为(在 `api_server/auth_routes.py`):

```python
    return {
        "auth_required": bool(getattr(Settings.basic_settings, "AUTH_REQUIRED", False)),
        "auth_allow_registration": bool(
            getattr(Settings.basic_settings, "AUTH_ALLOW_REGISTRATION", True)
        ),
        "admin_setup_required": not svc.admin_exists(),
    }
```

- [ ] **Step 4: 加 `_SetupBody` 与 `POST /auth/setup`**(放在 `register` 之后;顶部已 import `svc`/`_set_token_cookies`/`UserPublicSchema`/`status`)

```python
import threading
_SETUP_LOCK = threading.Lock()


class _SetupBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=256)
    instance_name: Optional[str] = None


@auth_router.post("/setup", response_model=_TokenPair, summary="首启:设置首个管理员")
def setup(body: _SetupBody, response: Response):
    """仅当系统尚无任何 admin 时可用:创建首个 admin 并直接登录。
    竞态安全:进程内锁 + 锁内重查;已存在 admin 返 409。"""
    with _SETUP_LOCK:
        if svc.admin_exists():
            raise HTTPException(status_code=409, detail="admin already exists")
        try:
            u = svc.create_user(body.username, body.password, role="admin")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if body.instance_name:
        try:
            from chayuan.server.auth import instance_meta
            from chayuan.settings import Settings
            from pathlib import Path
            root = Path(getattr(Settings.basic_settings, "CHAYUAN_ROOT", ".") or ".")
            instance_meta.set_instance_name(root, body.instance_name)
        except Exception as e:  # noqa: BLE001
            logger.warning("写实例标识失败(忽略): %r", e)
    access, refresh = svc.issue_token_pair(u)
    _set_token_cookies(response, access, refresh)
    return _TokenPair(
        access_token=access, refresh_token=refresh,
        user=UserPublicSchema.model_validate(u),
    )
```

> 注:`Settings.basic_settings.CHAYUAN_ROOT` 若属性名不同,按 `chayuan/settings.py` 实际的根路径访问器调整(参考 `license` 模块如何取 root)。

- [ ] **Step 5: 跑测试确认通过**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py -v`
Expected: PASS(全部)

- [ ] **Step 6: py_compile + Commit**

```bash
sudo /usr/bin/python3.11 -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/auth_routes.py
# bump + add(auth_routes.py + test + 版本文件)+ commit + push
sudo git commit -m "feat(auth): /auth/config 增 admin_setup_required + POST /auth/setup 首启建管理员"
```

---

### Task 4: 前端 — API 客户端(`endpoints.ts`)

**Files:**
- Modify: `chayuan-client/packages/api/src/endpoints.ts`

- [ ] **Step 1: `AuthConfig` 增字段 + 软降级默认**

把 `AuthConfig` 接口与 `auth.config()` 的兜底默认改为:

```typescript
export interface AuthConfig {
  auth_required: boolean;
  auth_allow_registration: boolean;
  admin_setup_required: boolean;
}
```

`config()` 内两处默认对象都补 `admin_setup_required: false`:

```typescript
      return r.data ?? { auth_required: false, auth_allow_registration: true, admin_setup_required: false };
    } catch {
      return { auth_required: false, auth_allow_registration: true, admin_setup_required: false };
```

- [ ] **Step 2: 加 `setupAdmin`**(放在 `auth` 对象内 `register` 之后,复用 `setTokens`)

```typescript
  async setupAdmin(body: { username: string; password: string; instanceName?: string }): Promise<TokenPair> {
    const data = await request<TokenPair>('/auth/setup', {
      method: 'POST',
      body: { username: body.username, password: body.password, instance_name: body.instanceName },
      raw: true,
    });
    await setTokens(data.data.access_token, data.data.refresh_token);
    return data.data;
  },
```

- [ ] **Step 3: typecheck**

Run(在 `chayuan-client` 下):`./node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
sudo git commit -m "feat(api): auth.setupAdmin + AuthConfig.admin_setup_required"
```

---

### Task 5: 前端 — loginModal store 增 `adminSetupRequired`

**Files:**
- Modify: `chayuan-client/packages/app/src/store/loginModal.ts`

- [ ] **Step 1: 接口 + 实现增字段**

`LoginModalState` 接口加:

```typescript
  /** 后端 admin_setup_required 镜像:为 true 时 Shell 渲染 AdminSetupGate(网络版) */
  adminSetupRequired: boolean;
  setAdminSetupRequired(v: boolean): void;
```

`create<LoginModalState>` 初始值与 setter 加:

```typescript
  adminSetupRequired: false,
  setAdminSetupRequired: (adminSetupRequired) => set({ adminSetupRequired }),
```

- [ ] **Step 2: typecheck**

Run:`./node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0(此时 Shell 未用,仅 store 编译)

- [ ] **Step 3: Commit**

```bash
sudo git commit -m "feat(client): loginModal store 增 adminSetupRequired"
```

---

### Task 6: 前端 — `AdminSetupGate` 组件

**Files:**
- Create: `chayuan-client/packages/app/src/features/auth/AdminSetupGate.tsx`

- [ ] **Step 1: 实现组件**(全屏、不可关闭;字段 用户名/密码/确认/实例标识)

```tsx
import * as React from 'react';
import { auth as authApi } from '@chayuan/api';
import { useAuthStore } from '../../store/auth';
import { useLoginModalStore } from '../../store/loginModal';

/** 网络版首启:无 admin 时全屏强制设置首个管理员。提交成功即登录并退出门。 */
export const AdminSetupGate: React.FC = () => {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [instanceName, setInstanceName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!username.trim()) return setErr('请输入用户名');
    if (password.length < 6) return setErr('密码至少 6 位');
    if (password !== confirm) return setErr('两次密码不一致');
    setBusy(true);
    try {
      const res = await authApi.setupAdmin({ username: username.trim(), password, instanceName: instanceName.trim() || undefined });
      setUser(res.user);
      useLoginModalStore.getState().setAdminSetupRequired(false);
    } catch (e2) {
      const status = (e2 as { status?: number })?.status;
      if (status === 409) {
        // 被并发抢先:转登录
        useLoginModalStore.getState().setAdminSetupRequired(false);
        useLoginModalStore.getState().lock();
        setErr('管理员已被创建,请改用登录');
      } else {
        setErr((e2 as Error)?.message || '设置失败,请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="text-lg font-semibold">首次使用 · 设置管理员</div>
        <div className="text-xs opacity-70">检测到系统尚无管理员,请创建首个管理员账户。</div>
        <input className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800" placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input type="password" className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800" placeholder="密码(≥6 位)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input type="password" className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800" placeholder="确认密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <input className="w-full rounded border px-3 py-2 text-sm dark:bg-zinc-800" placeholder="实例标识 / 名称(可选)" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
        {err && <div className="text-xs text-rose-600">{err}</div>}
        <button type="submit" disabled={busy} className="w-full rounded bg-[var(--cy-brand-600)] py-2 text-sm text-white disabled:opacity-50">
          {busy ? '设置中…' : '创建并进入'}
        </button>
      </form>
    </div>
  );
};
```

> 校验:确认 `useAuthStore` 暴露 `setUser`、`TokenPair.user` 字段名为 `user`(已核对 `store/auth.ts` / `endpoints.ts`)。

- [ ] **Step 2: typecheck**

Run:`./node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
sudo git commit -m "feat(client): AdminSetupGate 首启设置管理员全屏门"
```

---

### Task 7: 前端 — Shell 接线(web only)

**Files:**
- Modify: `chayuan-client/packages/app/src/Shell.tsx`

- [ ] **Step 1: 拉 config 后写入 adminSetupRequired**

在 Shell 拉 `/auth/config` 的 effect 里(`setAllowRegistration(...)` 旁边)加:

```typescript
      useLoginModalStore.getState().setAdminSetupRequired(
        Boolean(cfg.admin_setup_required) && isWeb(),
      );
```

(顶部确保 `import { isWeb } from '@chayuan/platform-shared';` 与 `useLoginModalStore` 已导入;`AdminSetupGate` 导入见下。)

- [ ] **Step 2: 渲染门(最高优先,盖过 LoginModal)**

在 Shell 返回的 JSX 顶层(LoginModal 渲染处之前)加:

```tsx
      {useLoginModalStore((s) => s.adminSetupRequired) && <AdminSetupGate />}
```

并在顶部 import:

```typescript
import { AdminSetupGate } from './features/auth/AdminSetupGate';
```

- [ ] **Step 3: typecheck**

Run:`./node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
sudo git commit -m "feat(client): Shell 网络版无 admin 时渲染 AdminSetupGate"
```

---

### Task 8: 文档 + 整体校验

**Files:**
- Modify: `docker/README.md`(或 compose 注释)— 首启设置说明 + 旧实例重置路径。

- [ ] **Step 1: 写运维说明**(追加到 `docker/README.md`)

要点:① 全新部署:留空 `CHAYUAN_AUTH_DEFAULT_ADMIN_PASSWORD`(或 compose 里 `AUTH_DEFAULT_ADMIN_PASSWORD: ""`),首次浏览器访问 `:8080` 会引导设管理员;② 想预置管理员仍可设非空密码(跳过向导);③ 升级旧实例若已被随机建过 admin:向导不弹,重置路径 = 进配置面板 `:8502` 删除/重置用户,或清空数据卷重来;④ 初始化期间建议限制网络可达(首访者即成管理员)。

- [ ] **Step 2: 全量校验**

Run(后端,真机):`PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m pytest tests/unit_tests/test_admin_setup.py -v`
Run(前端,`chayuan-client` 下):`./node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit && ./node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: 全 PASS / exit 0

- [ ] **Step 3: 真机端到端冒烟**(可选,需起服务)

清空用户表 → 起服务(`AUTH_DEFAULT_ADMIN_PASSWORD` 留空)→ 浏览器开 web → 应弹 AdminSetupGate → 设管理员 → 自动进入 → 刷新不再弹 → 配置面板能用该账户登录。

- [ ] **Step 4: Commit**

```bash
sudo git commit -m "docs: 网络版首启设置管理员运维说明 + 旧实例重置路径"
```

---

## 验收清单(对照 spec)
- [ ] 机制 1:无显式密码不预建 admin(Task 1)
- [ ] 触发用"无 admin"而非"表空"(Task 1 `admin_exists`)
- [ ] `/auth/config` 暴露 `admin_setup_required`(Task 3)
- [ ] `POST /auth/setup` 竞态安全 + 409(Task 3)
- [ ] 实例标识收集 + 持久化(Task 2 + Task 3)
- [ ] 仅网络版渲染门、单机不变(Task 7 `isWeb()`)
- [ ] 设管理员 ≠ 强制登录(未改 `AUTH_REQUIRED`,门与登录解耦)
- [ ] 旧实例重置路径文档(Task 8)

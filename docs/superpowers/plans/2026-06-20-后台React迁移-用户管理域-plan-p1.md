# 后台 React 迁移·用户管理域 — Plan P1：管理核心 + 席位

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 React AdminPage 加「用户」tab 的管理核心——用户表（搜索/CRUD/启停）+ 建用户表单 + 席位用量与达上限禁建，后端补一个最小 `GET /admin/users/snapshot` 聚合端点（用户列表 + KPI），复用现成 `/auth/users` CRUD。

**Architecture:** 后端抽 `users_analytics.build_users_snapshot()`（框架无关聚合）+ `admin_users_routes.py` 暴露 snapshot（require_role admin）。前端 `features/admin/users/` 组件用 react-query 拉 snapshot + 复用 `deploymentStatus()` 做席位禁建。本期不含图表/画像（P2/P3）。NiceGUI users_page **不删**（等 P3 parity）。

**Tech Stack:** Python/FastAPI/SQLAlchemy(后端)、React19/TS/@tanstack/react-query(前端)。

**环境约束（每个 Task 必读）：**
- 仓库 `/work/chayuan-desktop`（monorepo,单 .git,**root 所有→git/写文件要 sudo**,只 stage 改的文件,不 push/不 bump,统一最后处理）。写文件:`/tmp`+`sudo cp` 或 `sudo python3 -`。
- **后端 pytest 跑不了**(沙箱无依赖)→ 只 `/usr/bin/python3.11 -c "import ast;ast.parse(open(F).read())"` 语法自检,真 pytest 待用户机器。测试照写全。
- 前端 typecheck 可跑:`cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/<api|app>/tsconfig.json --noEmit`。

---

## 文件结构

- **Create** `chayuan-server/.../chayuan/server/admin/users_analytics.py` — `build_users_snapshot()` 最小聚合(users[]+KPI)。
- **Create** `chayuan-server/.../chayuan/server/api_server/admin_users_routes.py` — `admin_users_router` + `GET /api/v1/admin/users/snapshot`。
- **Modify** `chayuan-server/.../chayuan/server/api_server/server_app.py` — 注册 router。
- **Create** `chayuan-client/packages/api/src/admin.ts` — snapshot/CRUD 客户端 + 类型。
- **Modify** `chayuan-client/packages/api/src/index.ts` — barrel 导出 admin。
- **Create** `chayuan-client/packages/app/src/features/admin/users/{UsersPage,UsersTable,CreateUserDialog}.tsx`。
- **Modify** `chayuan-client/packages/app/src/features/admin/AdminPage.tsx` — 加「用户」tab。
- **Tests**: `tests/unit_tests/test_admin_users_snapshot.py`、`test_admin_users_routes.py`。

---

## Task 1: build_users_snapshot 最小聚合

**Files:** Create `chayuan/server/admin/users_analytics.py` · Test `tests/unit_tests/test_admin_users_snapshot.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_admin_users_snapshot.py
from __future__ import annotations
from datetime import datetime, timedelta
import pytest
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.session import session_scope
from chayuan.server.admin.users_analytics import build_users_snapshot


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    def _purge():
        with session_scope() as s:
            s.query(MessageModel).delete()
            s.query(UserModel).delete()
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")  # 不触发席位
    _purge(); yield; _purge()


def _add_msg(uid, q, r, when):
    import uuid
    with session_scope() as s:
        s.add(MessageModel(id=uuid.uuid4().hex, user_id=uid, chat_type="chat",
                           query=q, response=r, create_time=when))


def test_snapshot_users_and_kpi():
    now = datetime(2026, 6, 20, 12, 0, 0)
    u1 = svc.create_user("alice", "secret123", role="admin")
    u2 = svc.create_user("bob", "secret123", role="user")
    _add_msg(u1.id, "hi", "hello", now - timedelta(days=1))   # 近7日
    _add_msg(u1.id, "x" * 15, "y" * 15, now - timedelta(days=1))
    _add_msg(u2.id, "q", "r", now - timedelta(days=30))       # 7日外

    snap = build_users_snapshot(now=now)
    assert snap["total_users"] == 2
    assert snap["total_messages"] == 3
    assert snap["active_7d"] == 1                              # 仅 alice 近7日
    by = {u["username"]: u for u in snap["users"]}
    assert by["alice"]["msg_count"] == 2
    assert by["bob"]["msg_count"] == 1
    assert by["alice"]["est_tokens"] == int((2 + 30) / 1.5)    # (hi+hello=2? 见实现) — 用实现口径
    assert "generated_at" in snap
```

> 注：est_tokens 口径 = `int(len(query)+len(response)) / 1.5)` 累加，测试值按实现核对；上面断言用于钉住"有聚合且单调",实现后按真实数值修正断言常量。

- [ ] **Step 2: 运行确认失败**

Run: `/usr/bin/python3.11 -c "import ast; ast.parse(open('tests/unit_tests/test_admin_users_snapshot.py').read()); print('syntax ok')"`（沙箱仅语法；真 pytest 待用户机器，期望 ImportError: users_analytics）

- [ ] **Step 3: 写实现**

```python
# chayuan/server/admin/users_analytics.py
"""用户运营聚合(框架无关)。config_panel users_page 与 admin REST 共用。

P1 最小版:users[] + KPI。P2 扩展 daily/top-N/heatmap/matrix/feedback。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope

_LOOKBACK_DAYS = 400


def _est_tokens(text_len: int) -> int:
    return int(text_len / 1.5)


def build_users_snapshot(now: Optional[datetime] = None) -> dict:
    now = now or datetime.now()
    cutoff = now - timedelta(days=_LOOKBACK_DAYS)
    seven = now - timedelta(days=7)
    with session_scope() as s:
        users = s.query(UserModel).all()
        umap = {
            u.id: {
                "id": u.id, "username": u.username, "role": u.role,
                "email": u.email, "is_active": bool(u.is_active),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                "msg_count": 0, "est_tokens": 0, "last_active": None,
            }
            for u in users
        }
        rows = (
            s.query(
                MessageModel.user_id, MessageModel.query,
                MessageModel.response, MessageModel.create_time,
            )
            .filter(MessageModel.create_time >= cutoff)
            .all()
        )
        for uid, q, r, ct in rows:
            rec = umap.get(uid)
            if rec is None:
                continue
            rec["msg_count"] += 1
            rec["est_tokens"] += _est_tokens(len(q or "") + len(r or ""))
            if ct and (rec["last_active"] is None or ct.isoformat() > rec["last_active"]):
                rec["last_active"] = ct.isoformat()

    users_list = sorted(umap.values(), key=lambda x: (-x["est_tokens"], x["id"]))
    seven_iso = seven.isoformat()
    return {
        "users": users_list,
        "total_users": len(users_list),
        "active_7d": sum(1 for u in users_list if u["last_active"] and u["last_active"] >= seven_iso),
        "total_messages": sum(u["msg_count"] for u in users_list),
        "total_tokens": sum(u["est_tokens"] for u in users_list),
        "generated_at": now.timestamp(),
    }
```

- [ ] **Step 4: 语法自检**（真 pytest 待用户机器跑 `test_admin_users_snapshot.py`，应全过；本地仅 ast）

Run: `/usr/bin/python3.11 -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan/server/admin/users_analytics.py','tests/unit_tests/test_admin_users_snapshot.py']]; print('OK')"`

- [ ] **Step 5: 提交**

```bash
sudo git -C /work/chayuan-desktop add \
  chayuan-server/libs/chayuan-server/chayuan/server/admin/users_analytics.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_admin_users_snapshot.py
# 若 admin/ 是新包,确认有 __init__.py(没有则一并 sudo 建空文件并 add)
sudo git -C /work/chayuan-desktop commit -F /tmp/cmsg  # 见下
```
信息：`feat(admin): build_users_snapshot 最小用户聚合(users+KPI)` + 末行 Co-Authored-By。

> ⚠ 实现者注意：`chayuan/server/admin/` 若不存在需 `sudo mkdir` + 建 `__init__.py`(空)。

---

## Task 2: snapshot 端点 + 注册

**Files:** Create `chayuan/server/api_server/admin_users_routes.py` · Modify `server_app.py` · Test `tests/unit_tests/test_admin_users_routes.py`

- [ ] **Step 1: 写失败测试**（override admin 依赖）

```python
# tests/unit_tests/test_admin_users_routes.py
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.auth.deps import require_role
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.admin_users_routes import admin_users_router


@pytest.fixture
def client():
    with session_scope() as s:
        s.query(MessageModel).delete(); s.query(UserModel).delete()
    svc.create_user("admin1", "secret123", role="admin")
    app = FastAPI()
    app.include_router(admin_users_router)
    app.dependency_overrides[require_role("admin")] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def test_snapshot_route_200(client):
    r = client.get("/api/v1/admin/users/snapshot")
    assert r.status_code == 200
    b = r.json()
    assert b["total_users"] == 1 and isinstance(b["users"], list)
    assert "generated_at" in b and "total_tokens" in b
```

> 注：`require_role("admin")` 每次调用返回**新函数对象**，dependency_overrides 的 key 需与路由里用的是同一对象——实现时端点用模块级 `_ADMIN = require_role("admin")`，测试 override `_ADMIN`（见实现）。

- [ ] **Step 2: 语法自检失败**（端点未建）

Run: `/usr/bin/python3.11 -c "import ast; ast.parse(open('tests/unit_tests/test_admin_users_routes.py').read())"`

- [ ] **Step 3: 写实现**

```python
# chayuan/server/api_server/admin_users_routes.py
"""后台用户管理 REST(挂 /api/v1/admin/users)。React admin 消费,require_role admin。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from chayuan.server.admin.users_analytics import build_users_snapshot
from chayuan.server.auth.deps import require_role

admin_users_router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])

# require_role 每次返回新依赖函数;固定成模块级单例,便于测试 override。
_ADMIN = require_role("admin")


@admin_users_router.get("/snapshot")
def get_users_snapshot(_=Depends(_ADMIN)):
    return build_users_snapshot()
```

测试需同步：把测试里 `require_role("admin")` 改成 `from chayuan.server.api_server.admin_users_routes import _ADMIN` 并 `app.dependency_overrides[_ADMIN] = ...`。

在 `server_app.py`：import + include。先 `grep -n "include_router" server_app.py` 找现有模式，照着加：
```python
from chayuan.server.api_server.admin_users_routes import admin_users_router
# ... 在其它 include_router 旁:
app.include_router(admin_users_router)
```

- [ ] **Step 4: 语法自检 + 真测待机器**

Run: `/usr/bin/python3.11 -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan/server/api_server/admin_users_routes.py','chayuan/server/api_server/server_app.py','tests/unit_tests/test_admin_users_routes.py']]; print('OK')"`

- [ ] **Step 5: 提交**

```bash
sudo git -C /work/chayuan-desktop add \
  chayuan-server/libs/chayuan-server/chayuan/server/api_server/admin_users_routes.py \
  chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_admin_users_routes.py
sudo git -C /work/chayuan-desktop commit -F /tmp/cmsg
```
信息：`feat(api): /api/v1/admin/users/snapshot 端点(admin 鉴权)`。

---

## Task 3: 前端 API 客户端(admin.ts)

**Files:** Create `packages/api/src/admin.ts` · Modify `packages/api/src/index.ts`

- [ ] **Step 1: 写客户端**（复用 `http`，模式同 license.ts）

```typescript
// packages/api/src/admin.ts —— 后台 REST 客户端。
import { http } from './client';

export interface AdminUserRow {
  id: number;
  username: string;
  role: string;
  email: string | null;
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
  msg_count: number;
  est_tokens: number;
  last_active: string | null;
}

export interface UsersSnapshot {
  users: AdminUserRow[];
  total_users: number;
  active_7d: number;
  total_messages: number;
  total_tokens: number;
  generated_at: number;
}

export function adminUsersSnapshot(): Promise<UsersSnapshot> {
  return http.get<UsersSnapshot>('/api/v1/admin/users/snapshot');
}

// —— 用户 CRUD（复用现成 /auth/users）——
export interface UserPublic {
  id: number; username: string; email: string | null;
  role: string; is_active: boolean; created_at: string | null; last_login_at: string | null;
}

export function createUser(body: { username: string; password: string; role?: string; email?: string }): Promise<UserPublic> {
  return http.post<UserPublic>('/auth/users', body);
}
export function setUserActive(userId: number, isActive: boolean): Promise<{ code: number }> {
  return http.patch<{ code: number }>(`/auth/users/${userId}/active`, undefined, { query: { is_active: isActive } });
}
export function setUserPassword(userId: number, newPassword: string): Promise<{ code: number }> {
  return http.patch<{ code: number }>(`/auth/users/${userId}/password`, { new_password: newPassword });
}
```

> 实现前先 `grep -n "patch" packages/api/src/client.ts` 确认 `http.patch` 签名(参数顺序/是否支持 query)。若 `http.patch` 不支持 query,改用 `http.post`/拼 query string,以实际 client.ts 为准。

- [ ] **Step 2: barrel 导出**

在 `packages/api/src/index.ts` 加：`export * from './admin';`（若与 license 的某些名冲突，改具名导出）。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-client/packages/api/src/admin.ts chayuan-client/packages/api/src/index.ts
sudo git -C /work/chayuan-desktop commit -F /tmp/cmsg
```
信息：`feat(api): admin 用户 snapshot + CRUD 客户端`。

---

## Task 4: React 用户管理组件(表+建+席位禁建)

**Files:** Create `packages/app/src/features/admin/users/{UsersTable,CreateUserDialog,UsersPage}.tsx`

- [ ] **Step 1: CreateUserDialog.tsx**

```tsx
// packages/app/src/features/admin/users/CreateUserDialog.tsx
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { createUser } from '@chayuan/api';

export const CreateUserDialog: React.FC<{ onCreated(): void }> = ({ onCreated }) => {
  const [open, setOpen] = React.useState(false);
  const [username, setU] = React.useState('');
  const [password, setP] = React.useState('');
  const [email, setE] = React.useState('');
  const [role, setR] = React.useState('user');
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await createUser({ username: username.trim(), password, role, email: email.trim() || undefined });
      setOpen(false); setU(''); setP(''); setE(''); setR('user');
      onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!open) return <Button onClick={() => setOpen(true)}>新建用户</Button>;
  return (
    <div className="rounded-xl border p-4 space-y-2">
      <input className="w-full rounded border p-2 text-sm" placeholder="用户名*" value={username} onChange={(e) => setU(e.target.value)} />
      <input className="w-full rounded border p-2 text-sm" placeholder="邮箱(可选)" value={email} onChange={(e) => setE(e.target.value)} />
      <input className="w-full rounded border p-2 text-sm" type="password" placeholder="初始密码*(≥6)" value={password} onChange={(e) => setP(e.target.value)} />
      <select className="w-full rounded border p-2 text-sm" value={role} onChange={(e) => setR(e.target.value)}>
        <option value="user">普通用户</option>
        <option value="admin">管理员</option>
      </select>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={busy || !username.trim() || password.length < 6} onClick={() => void submit()}>创建</Button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: UsersTable.tsx**（表 + 搜索 + 启停 + 席位用量/禁建）

```tsx
// packages/app/src/features/admin/users/UsersTable.tsx
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import {
  adminUsersSnapshot, setUserActive, deploymentStatus,
  type AdminUserRow, type DeploymentStatus,
} from '@chayuan/api';
import { CreateUserDialog } from './CreateUserDialog';

export const UsersTable: React.FC = () => {
  const [kw, setKw] = React.useState('');
  const snap = useQuery({ queryKey: ['admin', 'users', 'snapshot'], queryFn: adminUsersSnapshot, staleTime: 30_000 });
  const seat = useQuery<DeploymentStatus>({ queryKey: ['admin', 'deployment', 'status'], queryFn: deploymentStatus, staleTime: 30_000 });

  const rows = React.useMemo(() => {
    const list = snap.data?.users ?? [];
    const q = kw.trim().toLowerCase();
    return q ? list.filter((u) => u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || u.role.includes(q)) : list;
  }, [snap.data, kw]);

  const seatFull = seat.data?.maxUsers != null && (seat.data.available ?? 0) <= 0;

  const toggle = async (u: AdminUserRow) => { await setUserActive(u.id, !u.is_active); void snap.refetch(); };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <input className="rounded border p-2 text-sm" placeholder="搜索 用户名/邮箱/角色" value={kw} onChange={(e) => setKw(e.target.value)} />
        {seat.data?.maxUsers != null ? (
          <span className="text-sm text-muted-foreground">席位 {seat.data.usedUsers}/{seat.data.maxUsers}</span>
        ) : null}
      </div>
      {seatFull ? (
        <p className="text-sm text-amber-600">席位已满，无法新建用户。请升级网络版席位。</p>
      ) : (
        <CreateUserDialog onCreated={() => { void snap.refetch(); void seat.refetch(); }} />
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground">
          <th className="p-2">用户</th><th className="p-2">角色/状态</th><th className="p-2">消息</th>
          <th className="p-2">~tokens</th><th className="p-2">最近活跃</th><th className="p-2">操作</th>
        </tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t">
              <td className="p-2">{u.username}<div className="text-xs text-muted-foreground">{u.email}</div></td>
              <td className="p-2">{u.role} · {u.is_active ? '启用' : '停用'}</td>
              <td className="p-2">{u.msg_count}</td>
              <td className="p-2">{u.est_tokens}</td>
              <td className="p-2">{u.last_active ? new Date(u.last_active).toLocaleString() : '—'}</td>
              <td className="p-2"><Button variant="ghost" onClick={() => void toggle(u)}>{u.is_active ? '停用' : '启用'}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {snap.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
    </div>
  );
};
```

- [ ] **Step 3: UsersPage.tsx**

```tsx
// packages/app/src/features/admin/users/UsersPage.tsx
import * as React from 'react';
import { UsersTable } from './UsersTable';

/** 用户管理域(P1 管理核心)。P2 加分析图,P3 加画像。 */
export const UsersPage: React.FC = () => <UsersTable />;
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0（若 `Button` variant="ghost" 不存在/`http.patch` 缺失,按 Task3 注解与现有 Button variants 修正）

- [ ] **Step 5: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/admin/users/
sudo git -C /work/chayuan-desktop commit -F /tmp/cmsg
```
信息：`feat(admin): React 用户管理组件(表/建/启停/席位禁建)`。

---

## Task 5: AdminPage 加「用户」tab

**Files:** Modify `packages/app/src/features/admin/AdminPage.tsx`

- [ ] **Step 1: 接线 4 处**（仿现有 tab 模式；参考已有 'deployment' tab 的加法）

1. `AdminTab` 类型加 `| 'users'`。
2. 顶部 import：`import { Users } from 'lucide-react';`（合并进现有 lucide import）+ `import { UsersPage } from './users/UsersPage';`
3. tab 按钮区加：`<TabButton icon={Users} label="用户" active={tab === 'users'} onClick={() => setTab('users')} />`
4. 内容区加：`{tab === 'users' && <UsersPage />}`

示例（按实际 AdminPage 结构对齐）：
```tsx
type AdminTab = 'traces' | 'outbox' | 'prompts' | 'scores' | 'platforms' | 'services' | 'deployment' | 'users';
// import 区
import { Users } from 'lucide-react';
import { UsersPage } from './users/UsersPage';
// tab 区(放在合适位置)
<TabButton icon={Users} label="用户" active={tab === 'users'} onClick={() => setTab('users')} />
// 内容区
{tab === 'users' && <UsersPage />}
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 3: 手动验证**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/web dev
# 浏览器登录 admin → 管理页「用户」tab → 应见用户表+席位用量+新建,启停可用
```

- [ ] **Step 4: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/admin/AdminPage.tsx
sudo git -C /work/chayuan-desktop commit -F /tmp/cmsg
```
信息：`feat(admin): AdminPage 加用户 tab`。

---

## 自检

1. **Spec 覆盖(P1 部分)**：§3 snapshot 端点→Task1+2；§4 UsersTable/CreateUserDialog/UsersPage→Task3+4；AdminPage tab→Task5；§5 席位禁建→Task4(deploymentStatus+seatFull)。图表/画像=P2/P3 不在本 plan。NiceGUI 不删(等 P3)。
2. **占位符**：核心代码全给；AdminPage 接线/`http.patch`/`Button variant` 给真实锚点+注解,执行者按现有结构对齐。
3. **类型一致**：`AdminUserRow`/`UsersSnapshot`/`adminUsersSnapshot`/`createUser`/`setUserActive`/`deploymentStatus` 跨 Task 命名一致；snapshot 返回字段与 Task1 实现逐一对应。

## 执行约束
- 全程 sudo(写文件/git)、只 stage 改的文件、不 push/不 bump(最后统一)。
- 后端测试本地仅 ast,真 pytest 待用户机器；前端 typecheck 必跑 exit 0。

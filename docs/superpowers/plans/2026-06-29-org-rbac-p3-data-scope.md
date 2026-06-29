# 角色数据权限 data_scope（P3）实施计划

> 每个 Task 一个 subagent，TDD。仓库根 /work/chayuan-desktop，分支 main，直接在 main 上做。

**Goal:** 角色带「数据权限范围」(data_scope)；据有效角色算出用户的可见部门集合(data_scope_dept_ids)；接到后台用户列表过滤。

## 通用约定（同 P1/P2）
- 仓库 root 所有：git/写源码目录需 sudo（新文件 scratchpad temp + `sudo cp` + `sudo chown root:root`；改文件同理）。tests 目录可直接写。只 stage 本 task 文件。不 push、不 bump（留 P3-T4 统一）。
- 角色键用 **role_name**。commit message 末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 路径简写 `SRV/`=`chayuan-server/libs/chayuan-server/chayuan/server/`，`LIB/`=`chayuan-server/libs/chayuan-server/`。

## 测试环境配方
解释器 `/tmp/agentvenv/bin/python`(3.11.13)。每 task 用独立 root：
```
cd /work/chayuan-desktop/chayuan-server
export CHAYUAN_ROOT="/tmp/claude-1000/-work-chayuan-desktop/3906fece-2bc2-4715-935c-d94ab837060a/scratchpad/p3t<N>_root" && mkdir -p "$CHAYUAN_ROOT"
PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -c "import chayuan.server.db.models; from chayuan.server.db.base import Base; from chayuan.server.db.session import SessionLocal; Base.metadata.create_all(SessionLocal().get_bind())"
PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -m pytest -o addopts="" -p no:cacheprovider -q <tests>
```

## data_scope 语义
```
data_scope int: 1全部 / 2自定义 / 3本部门 / 4本部门及以下 / 5仅本人  (默认 3)
seed: admin → 1全部; user → 5仅本人; 其它新角色默认 3本部门
data_scope(user_id, dept_id) 据 effective_roles 取最宽:
  任一角色=1全部           → ("all", None)         不过滤
  否则汇总各角色可见部门:
    4本部门及以下 → user.dept 子树(subtree_ids)
    3本部门       → {user.dept}
    2自定义       → 该角色 role_scope_depts 配的部门集
    5仅本人       → 不贡献部门
  汇总非空 → ("depts", frozenset(dept_ids))
  汇总为空(全是仅本人/无部门) → ("self", None)   只看自己
```

---

## Task P3-T1: ORM + 迁移 0030（roles.data_scope 列 + role_scope_depts 表 + seed）

**Files:** Create `SRV/db/models/role_scope_dept_model.py`; Modify `SRV/db/models/role_model.py`(加 data_scope 列 + to_dict 带上)、`SRV/db/models/__init__.py`(注册新 model); Create `SRV/db/alembic/versions/0030_role_data_scope.py`

- [ ] **Step 1** 写 `SRV/db/models/role_scope_dept_model.py`:
```python
"""角色自定义数据权限的部门集合（仅 data_scope=2 自定义时用）。"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String

from chayuan.server.db.base import Base


class RoleScopeDeptModel(Base):
    __tablename__ = "role_scope_depts"

    role_name = Column(String(16), primary_key=True, nullable=False, comment="角色名")
    dept_id = Column(Integer, primary_key=True, nullable=False, comment="部门 id")
```

- [ ] **Step 2** 改 `SRV/db/models/role_model.py`：在 `modules` 列后加：
```python
    data_scope = Column(Integer, nullable=False, server_default="3", default=3, comment="数据权限:1全部/2自定义/3本部门/4本部门及以下/5仅本人")
```
（确保 import 里有 `Integer`——已有。）并在 `to_dict` 返回 dict 里加一项：
```python
            "data_scope": int(self.data_scope or 3),
```

- [ ] **Step 3** 在 `SRV/db/models/__init__.py` 末尾追加：
```python
from chayuan.server.db.models import role_scope_dept_model  # noqa: F401
```

- [ ] **Step 4** 写迁移 `SRV/db/alembic/versions/0030_role_data_scope.py`（down_revision=当前头 `0029_user_dept_roles`）:
```python
"""角色数据权限 data_scope(P3 org-RBAC)。

roles 加 data_scope 列(默认3本部门);新增 role_scope_depts 表(自定义范围部门集);
seed:admin→1全部, user→5仅本人。两种建表模式都安全。

Revision ID: 0030_role_data_scope
Revises: 0029_user_dept_roles
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0030_role_data_scope"
down_revision = "0029_user_dept_roles"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_col(table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if _has_table("roles") and not _has_col("roles", "data_scope"):
        op.add_column("roles", sa.Column("data_scope", sa.Integer(), nullable=False, server_default="3"))
    if not _has_table("role_scope_depts"):
        op.create_table(
            "role_scope_depts",
            sa.Column("role_name", sa.String(length=16), nullable=False),
            sa.Column("dept_id", sa.Integer(), nullable=False),
            sa.PrimaryKeyConstraint("role_name", "dept_id"),
        )
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE roles SET data_scope = 1 WHERE name = 'admin'"))
    bind.execute(sa.text("UPDATE roles SET data_scope = 5 WHERE name = 'user'"))


def downgrade() -> None:
    if _has_table("role_scope_depts"):
        op.drop_table("role_scope_depts")
    if _has_table("roles") and _has_col("roles", "data_scope"):
        op.drop_column("roles", "data_scope")
```

- [ ] **Step 5** 冒烟 + 头唯一 + py_compile + 应用验证（同 P2-T2 方式：fresh CHAYUAN_ROOT，stamp 0029 → upgrade head，确认 roles 有 data_scope 列、role_scope_depts 表存在、admin.data_scope=1/user.data_scope=5）。冒烟：
```
PYTHONPATH=libs/chayuan-server /tmp/agentvenv/bin/python -c "import chayuan.server.db.models; from chayuan.server.db.base import Base; print('role_scope_depts' in Base.metadata.tables); from chayuan.server.db.models.role_model import RoleModel; print('data_scope' in RoleModel.__table__.columns)"
```
Expected `True` / `True`。
- [ ] **Step 6** Commit（`feat(org): P3 ORM+migration — roles.data_scope + role_scope_depts + seed`），stage 4 文件。

---

## Task P3-T2: role_repository + roles_routes 支持 data_scope

**Files:** Modify `SRV/db/repository/role_repository.py`、`SRV/api_server/roles_routes.py`; Test `LIB/tests/unit_tests/test_role_data_scope.py`

- [ ] **Step 1** 写测试 `test_role_data_scope.py`:
```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.role_model import RoleModel
from chayuan.server.db.models.role_scope_dept_model import RoleScopeDeptModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import role_repository as rr


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(RoleScopeDeptModel).delete()
            s.query(RoleModel).filter(RoleModel.is_system == False).delete()  # noqa: E712
    _purge(); rr.ensure_builtin_roles(); yield; _purge()


def test_create_role_with_data_scope():
    r = rr.create_role("mgr", "主管", ["kbcfg"], data_scope=4)
    assert r["data_scope"] == 4


def test_update_role_data_scope_and_custom_depts():
    rr.create_role("mgr2", "", ["kbcfg"], data_scope=3)
    rr.update_role("mgr2", description=None, modules=None, data_scope=2, scope_dept_ids=[10, 20])
    sc, depts = rr.get_role_scope("mgr2")
    assert sc == 2 and set(depts) == {10, 20}


def test_builtin_scopes_seed():
    # admin/user 的 data_scope 由迁移 seed;create_all 模式下默认 3,
    # 故本测试仅校验 get_role 能取到 data_scope 字段(不强依赖 seed 值)
    assert "data_scope" in rr.get_role("admin")


def test_get_role_scope_default():
    rr.create_role("mgr3", "", [], data_scope=3)
    sc, depts = rr.get_role_scope("mgr3")
    assert sc == 3 and depts == []
```

- [ ] **Step 2** 跑确认 FAIL。
- [ ] **Step 3** 改 `SRV/db/repository/role_repository.py`：
  (a) `create_role` 增参 `data_scope: int = 3`，建 RoleModel 时设 `data_scope=data_scope`。
  (b) `update_role` 增参 `data_scope: Optional[int] = None`、`scope_dept_ids: Optional[List[int]] = None`；data_scope 非空则更新（admin 例外可不限制）；scope_dept_ids 非空则调 set_role_scope_depts。
  (c) 新增：
```python
def get_role_scope(name: str):
    """返回 (data_scope:int, [dept_ids])。"""
    from chayuan.server.db.models.role_scope_dept_model import RoleScopeDeptModel
    with session_scope() as s:
        r = s.query(RoleModel).filter(RoleModel.name == name).one_or_none()
        if not r:
            return (5, [])
        depts = [row[0] for row in s.query(RoleScopeDeptModel.dept_id).filter(
            RoleScopeDeptModel.role_name == name).all()]
        return (int(r.data_scope or 3), depts)


def set_role_scope_depts(name: str, dept_ids):
    from chayuan.server.db.models.role_scope_dept_model import RoleScopeDeptModel
    ids = []
    for d in (dept_ids or []):
        try:
            di = int(d)
        except (TypeError, ValueError):
            continue
        if di not in ids:
            ids.append(di)
    with session_scope() as s:
        s.query(RoleScopeDeptModel).filter(RoleScopeDeptModel.role_name == name).delete()
        for di in ids:
            s.add(RoleScopeDeptModel(role_name=name, dept_id=di))
    return ids
```
  注意：`create_role`/`update_role` 的现有 try/校验逻辑保留，仅扩参；data_scope 用 `int(data_scope or 3)` 兜底，限制在 1..5（越界回退 3）。
- [ ] **Step 4** 改 `SRV/api_server/roles_routes.py`：
  - POST：从 body 取 `data_scope`(默认3) 传给 create_role；建后若 data_scope==2 且 body 带 scope_dept_ids,调 set_role_scope_depts。
  - PATCH：从 body 取 `data_scope`、`scope_dept_ids` 传给 update_role。
  - GET 列表：每个角色 dict 已含 data_scope（to_dict）；额外为前端附 scope_dept_ids（可选：对 data_scope==2 的角色附其部门集；简单做法是 GET 时不附，前端按需查——本期 GET 仅返回 data_scope，scope_dept_ids 通过 PATCH 往返即可）。最小实现：POST/PATCH 接收并落库，GET 的 to_dict 已带 data_scope。
- [ ] **Step 5** 跑测试确认 PASS（4 条）+ 回归 `test_user_role_repository.py`(effective_modules_multi 不受影响)应仍绿。
- [ ] **Step 6** Commit（`feat(org): role_repository+routes data_scope + custom scope depts`），stage 3 文件。

---

## Task P3-T3: data_scope 计算 helper + 接到后台用户列表（TDD）

**Files:** Modify `SRV/db/repository/user_role_repository.py`(加 data_scope())、`SRV/api_server/auth_routes.py`(admin_list_users 过滤); Test `LIB/tests/unit_tests/test_data_scope.py`

- [ ] **Step 1** 写测试 `test_data_scope.py`:
```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.role_model import RoleModel
from chayuan.server.db.models.role_scope_dept_model import RoleScopeDeptModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import org_repository as orgs
from chayuan.server.db.repository import dept_repository as depts
from chayuan.server.db.repository import role_repository as rr
from chayuan.server.db.repository import user_role_repository as urr


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            for M in (RoleScopeDeptModel, UserRoleModel, UserModel, DepartmentModel, OrganizationModel):
                s.query(M).delete()
            s.query(RoleModel).filter(RoleModel.is_system == False).delete()  # noqa: E712
    _purge(); rr.ensure_builtin_roles(); yield; _purge()


def _user(dept_id=None, roles=("user",)):
    with session_scope() as s:
        u = UserModel(username="u", password_hash="x", role=roles[0], is_active=True, dept_id=dept_id)
        s.add(u); s.flush(); s.refresh(u); s.expunge(u); uid = u.id
    urr.set_user_roles(uid, list(roles))
    return uid


def test_scope_all_for_admin():
    uid = _user(roles=("admin",))
    mode, ids = urr.data_scope(uid, None)
    assert mode == "all" and ids is None


def test_scope_self_for_plain_user():
    uid = _user(roles=("user",))  # user 默认 data_scope=5仅本人(create_all 默认3→需显式设)
    rr.update_role("user", description=None, modules=None, data_scope=5)
    mode, ids = urr.data_scope(uid, None)
    assert mode == "self"


def test_scope_dept_and_subtree():
    o = orgs.create_org("o", "o")
    parent = depts.create_dept(o["id"], None, "总部")
    child = depts.create_dept(o["id"], parent["id"], "小组")
    rr.create_role("mgr", "", [], data_scope=4)  # 本部门及以下
    uid = _user(dept_id=parent["id"], roles=("mgr",))
    mode, ids = urr.data_scope(uid, parent["id"])
    assert mode == "depts" and {parent["id"], child["id"]} <= set(ids)


def test_scope_custom():
    rr.create_role("cust", "", [], data_scope=2)
    rr.set_role_scope_depts("cust", [101, 202])
    uid = _user(roles=("cust",))
    mode, ids = urr.data_scope(uid, None)
    assert mode == "depts" and set(ids) == {101, 202}
```

- [ ] **Step 2** 跑确认 FAIL（data_scope 不存在）。
- [ ] **Step 3** 在 `SRV/db/repository/user_role_repository.py` 末尾加：
```python
def data_scope(user_id: int, dept_id: Optional[int]):
    """返回 (mode, dept_ids):
      ("all", None)                全部数据,不过滤
      ("depts", frozenset(ids))    仅这些部门
      ("self", None)               只看自己
    取所有有效角色里最宽的范围(全部 > 部门集 > 仅本人)。
    """
    from chayuan.server.db.repository import role_repository as rr
    from chayuan.server.db.repository import dept_repository as dr
    roles = effective_roles(user_id, dept_id)
    depts: set = set()
    saw_any = False
    for rn in roles:
        sc, custom = rr.get_role_scope(rn)
        saw_any = True
        if sc == 1:
            return ("all", None)
        if sc == 4:
            if dept_id is not None:
                depts |= set(dr.subtree_ids(dept_id))
        elif sc == 3:
            if dept_id is not None:
                depts.add(dept_id)
        elif sc == 2:
            depts |= set(custom)
        # sc == 5 仅本人:不贡献部门
    if depts:
        return ("depts", frozenset(depts))
    return ("self", None)
```
- [ ] **Step 4** 改 `SRV/api_server/auth_routes.py` 的 `admin_list_users`，按请求者 data_scope 过滤（保持 require_role("admin") 不变；admin=全部→不过滤,基础设施已就位）：
```python
@auth_router.get("/users", response_model=List[UserPublicSchema], summary="[admin] 列用户")
def admin_list_users(cur: Dict[str, Any] = Depends(require_role("admin")), limit: int = 100, offset: int = 0):
    from chayuan.server.db.repository import user_role_repository as urr
    from chayuan.server.db.session import session_scope
    from chayuan.server.db.models.user_model import UserModel as _U
    uid = int(cur.get("id") or 0)
    dept_id = None
    if uid > 0:
        full = svc.get_user_by_id(uid)
        dept_id = getattr(full, "dept_id", None) if full else None
    mode, ids = urr.data_scope(uid, dept_id) if uid > 0 else ("all", None)
    with session_scope() as s:
        q = s.query(_U)
        if mode == "depts":
            q = q.filter(_U.dept_id.in_(list(ids)))
        elif mode == "self":
            q = q.filter(_U.id == uid)
        rows = q.order_by(_U.id).offset(offset).limit(limit).all()
        return [_user_public(u) for u in rows]
```
  （注：原 admin_list_users 用 `svc.list_users`;这里改为带 scope 过滤的查询。`require_role("admin")` 的依赖返回的是 user dict，赋给 `cur`。保留 `_user_public`。）
- [ ] **Step 5** 跑 `test_data_scope.py` 确认 PASS（4 条）+ 回归 `test_p2_routes.py`(admin 列用户仍返回全部,因 admin=全部) 应仍绿。
- [ ] **Step 6** Commit（`feat(org): data_scope helper + scope-filtered admin user list`），stage 3 文件。

---

## Task P3-T4: P3 收尾（由 controller 跑）
- 全量 P1+P2+P3 + 回归测试全绿；bump + push 由 controller 统一处理。

## 自查
- Spec 覆盖:roles.data_scope+role_scope_depts(T1)、role 配置 data_scope(T2)、data_scope_dept_ids 取最大范围(T3)、接后台用户列表(T3)。
- 用户分析快照(admin_users snapshot)接 data_scope 留到后续(本期先接用户列表,基础设施 data_scope() 已可复用)。
- 向后兼容:admin=全部→列表不过滤,行为不变;role to_dict 加 data_scope 是新增字段。

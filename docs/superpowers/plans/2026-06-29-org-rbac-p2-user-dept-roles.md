# 用户多角色 + 部门归属 + 有效角色（P2）实施计划

> **For agentic workers:** 每个 Task 用一个 subagent，TDD。仓库根 /work/chayuan-desktop（单 git 仓，分支 main，直接在 main 上做，不建分支）。

**Goal:** 用户支持多角色 + 归属部门；计算「有效角色 = 直接角色 ∪ 部门链继承角色」；`/auth/me/modules` 与用户 API 升级（全部向后兼容）。

**Tech Stack:** Python / FastAPI / SQLAlchemy / Alembic / pytest。

## 通用约定（每个 commit 步骤遵守）
- 仓库 root 所有：`git`/写源码目录需 `sudo`（源码目录写新文件用 scratchpad temp + `sudo cp` 并 `sudo chown root:root`；测试目录 `LIB/tests/unit_tests/` 可直接写）。只 stage 本 task 列出的文件。**不 push、不 bump**（push+bump 留到 P6，或按 controller 指示）。
- 角色键一律用 **role_name**（String(16)，稳定不可改名），不用 role_id。
- 路径简写：`SRV/` = `/work/chayuan-desktop/chayuan-server/libs/chayuan-server/chayuan/server/`，`LIB/` = `/work/chayuan-desktop/chayuan-server/libs/chayuan-server/`。
- commit message 末尾加：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## 测试环境配方（每次跑 pytest 用这个）
解释器 `/tmp/agentvenv/bin/python`（3.11.13，含项目依赖；本机无 conda/py312）。测试不自动建表且默认 DB 是 root-owned，必须用全新可写 CHAYUAN_ROOT + 先 bootstrap：
```
cd /work/chayuan-desktop/chayuan-server
export CHAYUAN_ROOT="/tmp/claude-1000/-work-chayuan-desktop/3906fece-2bc2-4715-935c-d94ab837060a/scratchpad/p2t<N>_root"
mkdir -p "$CHAYUAN_ROOT"
PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -c "import chayuan.server.db.models; from chayuan.server.db.base import Base; from chayuan.server.db.session import SessionLocal; Base.metadata.create_all(SessionLocal().get_bind())"
PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -m pytest -o addopts="" -p no:cacheprovider -q <test files>
```
（同一 CHAYUAN_ROOT 用于 bootstrap 与测试。每个 Task 用独立 root 目录名避免脏数据。）

## 数据模型（P2 新增）
```
user_roles   用户-角色 多对多
  user_id INT, role_name STR(16)   PK(user_id, role_name)

dept_roles   部门-角色映射(部门成员继承)
  dept_id INT, role_name STR(16), include_subtree BOOL   PK(dept_id, role_name)

users  + dept_id INT 可空 index  (未分配=NULL)
```
回填：存量每个 user 插一行 user_roles(user.id, user.role)。dept_id 留 NULL（未分配，admin 后续指派）。

## 有效角色语义
```
effective_roles(user_id, dept_id):
  direct = {ur.role_name for user_roles where user_id}
  若 dept_id 为空 → inherited = {}
  否则:
    chain = 解析该部门 ancestors(",a,b,...,self,") 得到 id 列表
    own = dept_id(==self); ancestors = chain - {self}
    inherited = {dr.role_name | dept_roles where dept_id == own}                      # 直属:不论 include_subtree
              ∪ {dr.role_name | dept_roles where dept_id in ancestors and include_subtree}  # 上级:仅传子树的
  return sorted(direct ∪ inherited)
  # guest / id<=0 → 直接用调用方传入的单 role(不查库)
```

---

## Task P2-T1: ORM（users.dept_id + UserRoleModel + DeptRoleModel）

**Files:** Create `SRV/db/models/user_role_model.py`, `SRV/db/models/dept_role_model.py`; Modify `SRV/db/models/user_model.py`（加 dept_id 列）, `SRV/db/models/__init__.py`（注册两新 model）。

- [ ] **Step 1** 写 `SRV/db/models/user_role_model.py`:
```python
"""用户-角色 多对多 ORM（按角色名键，role_name=RoleModel.name/User.role）。"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String

from chayuan.server.db.base import Base


class UserRoleModel(Base):
    __tablename__ = "user_roles"

    user_id = Column(Integer, primary_key=True, nullable=False, comment="用户 id")
    role_name = Column(String(16), primary_key=True, nullable=False, comment="角色名")
```

- [ ] **Step 2** 写 `SRV/db/models/dept_role_model.py`:
```python
"""部门-角色映射 ORM（部门成员继承这些角色；include_subtree=是否传给下级部门）。"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, Integer, String

from chayuan.server.db.base import Base


class DeptRoleModel(Base):
    __tablename__ = "dept_roles"

    dept_id = Column(Integer, primary_key=True, nullable=False, comment="部门 id")
    role_name = Column(String(16), primary_key=True, nullable=False, comment="角色名")
    include_subtree = Column(Boolean, nullable=False, default=False, comment="是否传给下级部门")
```

- [ ] **Step 3** 修改 `SRV/db/models/user_model.py`：在 `is_active` 列后、`created_at` 前加一行：
```python
    dept_id = Column(Integer, nullable=True, index=True, comment="所属部门 id(可空,未分配=NULL)")
```
并在 `UserPublicSchema` 里 `is_active: bool` 后加两个可选字段（向后兼容）：
```python
    dept_id: Optional[int] = None
    roles: List[str] = []
```
（文件顶部 import 需有 `from typing import List, Optional`；若缺 List 则补。）

- [ ] **Step 4** 在 `SRV/db/models/__init__.py` 末尾按模块导入风格追加：
```python
from chayuan.server.db.models import user_role_model  # noqa: F401
from chayuan.server.db.models import dept_role_model  # noqa: F401
```

- [ ] **Step 5** 冒烟：
```
cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -c "import chayuan.server.db.models; from chayuan.server.db.base import Base; t=set(Base.metadata.tables); print('user_roles' in t, 'dept_roles' in t); from chayuan.server.db.models.user_model import UserModel; print('dept_id' in UserModel.__table__.columns)"
```
Expected: `True True` 然后 `True`。

- [ ] **Step 6** Commit（`feat(org): P2 ORM — user_roles/dept_roles + users.dept_id`），stage 这 4 个文件。

---

## Task P2-T2: 迁移 0029（建表 + 加列 + 回填）

**Files:** Create `SRV/db/alembic/versions/0029_user_dept_roles.py`

- [ ] **Step 1** 写迁移（down_revision = 当前头 `0028_org_dept`）:
```python
"""用户多角色 + 部门归属(P2 org-RBAC)。

新增 user_roles(用户-角色 多对多) + dept_roles(部门-角色映射) 两表;
给 users 加 dept_id 列(可空);回填存量 user 的 role 到 user_roles。
两种建表模式(create_all/alembic)都安全:表/列已存在则跳过。

Revision ID: 0029_user_dept_roles
Revises: 0028_org_dept
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0029_user_dept_roles"
down_revision = "0028_org_dept"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_col(table: str, col: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_table("user_roles"):
        op.create_table(
            "user_roles",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("role_name", sa.String(length=16), nullable=False),
            sa.PrimaryKeyConstraint("user_id", "role_name"),
        )
    if not _has_table("dept_roles"):
        op.create_table(
            "dept_roles",
            sa.Column("dept_id", sa.Integer(), nullable=False),
            sa.Column("role_name", sa.String(length=16), nullable=False),
            sa.Column("include_subtree", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.PrimaryKeyConstraint("dept_id", "role_name"),
        )
    if _has_table("users") and not _has_col("users", "dept_id"):
        op.add_column("users", sa.Column("dept_id", sa.Integer(), nullable=True))
        op.create_index("ix_users_dept_id", "users", ["dept_id"])

    # 回填:存量 user.role -> user_roles(幂等:仅插不存在的对)
    bind = op.get_bind()
    bind.execute(sa.text(
        "INSERT INTO user_roles (user_id, role_name) "
        "SELECT id, role FROM users u "
        "WHERE role IS NOT NULL AND role <> '' "
        "AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_name = u.role)"
    ))


def downgrade() -> None:
    if _has_table("users") and _has_col("users", "dept_id"):
        try:
            op.drop_index("ix_users_dept_id", table_name="users")
        except Exception:  # noqa: BLE001 - 某些后端无该索引
            pass
        op.drop_column("users", "dept_id")
    if _has_table("dept_roles"):
        op.drop_table("dept_roles")
    if _has_table("user_roles"):
        op.drop_table("user_roles")
```

- [ ] **Step 2** 校验头唯一：`grep -rl 'down_revision = "0028_org_dept"' .../versions/` → 只此文件。
- [ ] **Step 3** py_compile 通过（用 `PYTHONPYCACHEPREFIX=/tmp/...` 避开 root-owned __pycache__）。
- [ ] **Step 4** 应用验证（参照 P1 0028 的做法：读 env.py 用项目 migrator 在全新 CHAYUAN_ROOT 上 stamp 到 0028 再 upgrade head，确认 user_roles/dept_roles 表存在 + users 有 dept_id 列；再造一个有 user 的库验证回填把 role 写进 user_roles）。若 sandbox 跑不动项目 migrator，回退到对原始 sqlite 用 alembic command + 读 env 取 URL 的方式，诚实报告所用路径。
- [ ] **Step 5** Commit（`feat(org): P2 migration 0029 — user_roles/dept_roles + users.dept_id + backfill`）。

---

## Task P2-T3: user_role_repository（直接多角色读写 + 同步主角色）+ effective_modules_multi

**Files:** Create `SRV/db/repository/user_role_repository.py`; Modify `SRV/db/repository/role_repository.py`（加 effective_modules_multi）; Test `LIB/tests/unit_tests/test_user_role_repository.py`

- [ ] **Step 1** 写测试 `test_user_role_repository.py`:
```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import user_role_repository as urr
from chayuan.server.db.repository import role_repository as rr


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(UserRoleModel).delete()
            s.query(UserModel).delete()
    _purge(); yield; _purge()


def _mk_user(username="u1", role="user"):
    with session_scope() as s:
        u = UserModel(username=username, password_hash="x", role=role, is_active=True)
        s.add(u); s.flush(); s.refresh(u); s.expunge(u)
        return u.id


def test_set_and_get_user_roles():
    uid = _mk_user()
    urr.set_user_roles(uid, ["user", "admin"])
    assert set(urr.get_user_roles(uid)) == {"user", "admin"}


def test_set_user_roles_syncs_primary_admin_wins():
    uid = _mk_user(role="user")
    urr.set_user_roles(uid, ["user", "admin"])
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.id == uid).one()
        assert u.role == "admin"  # admin 优先做主角色


def test_set_user_roles_replaces():
    uid = _mk_user()
    urr.set_user_roles(uid, ["admin"])
    urr.set_user_roles(uid, ["user"])
    assert urr.get_user_roles(uid) == ["user"]


def test_empty_roles_falls_back_to_user():
    uid = _mk_user()
    urr.set_user_roles(uid, [])
    assert urr.get_user_roles(uid) == ["user"]
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.id == uid).one()
        assert u.role == "user"


def test_effective_modules_multi_admin_is_all():
    mods = rr.effective_modules_multi(["user", "admin"])
    from chayuan.server.admin.role_modules import ALL_MODULE_KEYS
    assert set(mods) == set(ALL_MODULE_KEYS)


def test_effective_modules_multi_union():
    rr.ensure_builtin_roles()
    rr.create_role("rolea", "", ["kbcfg"])
    rr.create_role("roleb", "", ["tools"])
    mods = set(rr.effective_modules_multi(["rolea", "roleb"]))
    assert {"kbcfg", "tools"} <= mods
```

- [ ] **Step 2** 跑测试确认 FAIL（user_role_repository / effective_modules_multi 不存在）。
- [ ] **Step 3** 写 `SRV/db/repository/user_role_repository.py`:
```python
"""用户-角色仓库（直接多角色读写 + 同步 User.role 主角色）。

角色键用 role_name。主角色规则:含 admin → "admin";否则取第一个;空 → "user"。
有效角色(含部门继承)见 effective_roles()。
"""
from __future__ import annotations

from typing import List, Optional

from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.dept_role_model import DeptRoleModel
from chayuan.server.db.session import session_scope


def _primary_role(role_names: List[str]) -> str:
    if "admin" in role_names:
        return "admin"
    return role_names[0] if role_names else "user"


def get_user_roles(user_id: int) -> List[str]:
    with session_scope() as s:
        rows = s.query(UserRoleModel.role_name).filter(
            UserRoleModel.user_id == user_id
        ).order_by(UserRoleModel.role_name).all()
        return [r[0] for r in rows]


def set_user_roles(user_id: int, role_names: List[str]) -> List[str]:
    # 去重、保序;空 → ["user"] 兜底
    seen = []
    for r in (role_names or []):
        r = (r or "").strip()
        if r and r not in seen:
            seen.append(r)
    if not seen:
        seen = ["user"]
    with session_scope() as s:
        s.query(UserRoleModel).filter(UserRoleModel.user_id == user_id).delete()
        for r in seen:
            s.add(UserRoleModel(user_id=user_id, role_name=r))
        u = s.query(UserModel).filter(UserModel.id == user_id).one_or_none()
        if u is not None:
            u.role = _primary_role(seen)  # 同步主角色(向后兼容)
    return seen


def _ancestor_ids(ancestors: Optional[str], self_id: int) -> List[int]:
    """从 ',a,b,self,' 解析祖先 id(不含 self)。"""
    if not ancestors:
        return []
    ids = [int(x) for x in ancestors.split(",") if x.strip().isdigit()]
    return [i for i in ids if i != self_id]


def effective_roles(user_id: int, dept_id: Optional[int]) -> List[str]:
    """有效角色 = 直接角色 ∪ 部门链继承角色。"""
    with session_scope() as s:
        direct = {r[0] for r in s.query(UserRoleModel.role_name).filter(
            UserRoleModel.user_id == user_id).all()}
        inherited: set = set()
        if dept_id is not None:
            from chayuan.server.db.models.dept_model import DepartmentModel
            dept = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
            if dept is not None:
                # 直属部门:不论 include_subtree 都继承
                for r in s.query(DeptRoleModel.role_name).filter(
                        DeptRoleModel.dept_id == dept_id).all():
                    inherited.add(r[0])
                # 上级部门:仅 include_subtree=True 的传下来
                anc = _ancestor_ids(dept.ancestors, dept_id)
                if anc:
                    for r in s.query(DeptRoleModel.role_name).filter(
                            DeptRoleModel.dept_id.in_(anc),
                            DeptRoleModel.include_subtree.is_(True)).all():
                        inherited.add(r[0])
        return sorted(direct | inherited)
```
- [ ] **Step 4** 在 `SRV/db/repository/role_repository.py` 末尾加：
```python
def effective_modules_multi(role_names: List[str]) -> List[str]:
    """多角色合并可见模块。含 admin → 全部;否则各角色 modules 的并集。"""
    names = [n for n in (role_names or []) if n]
    if "admin" in names:
        return list(ALL_MODULE_KEYS)
    out: List[str] = []
    seen = set()
    for n in names:
        for m in effective_modules(n):
            if m not in seen:
                seen.add(m); out.append(m)
    return out
```
- [ ] **Step 5** 跑测试确认 PASS（6 条）。
- [ ] **Step 6** Commit（`feat(org): user_role_repository (multi-role + primary sync + effective_roles) + effective_modules_multi`），stage 3 文件。

---

## Task P2-T4: dept_roles 读写（dept_repository 扩展）+ effective_roles 部门继承测试

**Files:** Modify `SRV/db/repository/dept_repository.py`（加 get_dept_roles/set_dept_roles）; Test：在 `test_user_role_repository.py` 追加部门继承用例（或新建 `test_dept_roles_inherit.py`，推荐后者保持文件聚焦）。

- [ ] **Step 1** 写测试 `LIB/tests/unit_tests/test_dept_roles_inherit.py`:
```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.dept_role_model import DeptRoleModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import org_repository as orgs
from chayuan.server.db.repository import dept_repository as depts
from chayuan.server.db.repository import user_role_repository as urr


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            for M in (DeptRoleModel, UserRoleModel, UserModel, DepartmentModel, OrganizationModel):
                s.query(M).delete()
    _purge(); yield; _purge()


def _mk_user(dept_id=None):
    with session_scope() as s:
        u = UserModel(username="u1", password_hash="x", role="user", is_active=True, dept_id=dept_id)
        s.add(u); s.flush(); s.refresh(u); s.expunge(u)
        return u.id


def test_set_get_dept_roles():
    o = orgs.create_org("o", "o")
    d = depts.create_dept(o["id"], None, "研发")
    depts.set_dept_roles(d["id"], [{"role_name": "admin", "include_subtree": True}])
    got = depts.get_dept_roles(d["id"])
    assert got == [{"role_name": "admin", "include_subtree": True}]


def test_effective_roles_inherits_own_dept():
    o = orgs.create_org("o", "o")
    d = depts.create_dept(o["id"], None, "研发")
    depts.set_dept_roles(d["id"], [{"role_name": "rolex", "include_subtree": False}])
    uid = _mk_user(dept_id=d["id"])
    urr.set_user_roles(uid, ["user"])
    assert set(urr.effective_roles(uid, d["id"])) == {"user", "rolex"}


def test_effective_roles_ancestor_only_when_subtree_true():
    o = orgs.create_org("o", "o")
    parent = depts.create_dept(o["id"], None, "总部")
    child = depts.create_dept(o["id"], parent["id"], "小组")
    # 上级挂两个角色:一个传子树,一个不传
    depts.set_dept_roles(parent["id"], [
        {"role_name": "inherit_me", "include_subtree": True},
        {"role_name": "stay_here", "include_subtree": False},
    ])
    uid = _mk_user(dept_id=child["id"])
    urr.set_user_roles(uid, [])
    eff = set(urr.effective_roles(uid, child["id"]))
    assert "inherit_me" in eff       # 上级 include_subtree=True → 继承
    assert "stay_here" not in eff    # 上级 include_subtree=False → 不继承
    assert "user" in eff             # 主角色兜底


def test_effective_roles_no_dept_is_direct_only():
    uid = _mk_user(dept_id=None)
    urr.set_user_roles(uid, ["user"])
    assert urr.effective_roles(uid, None) == ["user"]
```

- [ ] **Step 2** 跑测试确认 FAIL（set_dept_roles/get_dept_roles 不存在）。
- [ ] **Step 3** 在 `SRV/db/repository/dept_repository.py` 末尾追加（文件顶部 import 已有 DepartmentModel/session_scope；需补 `from chayuan.server.db.models.dept_role_model import DeptRoleModel`）：
```python
def get_dept_roles(dept_id) -> List[Dict[str, Any]]:
    from chayuan.server.db.models.dept_role_model import DeptRoleModel
    with session_scope() as s:
        rows = s.query(DeptRoleModel).filter(
            DeptRoleModel.dept_id == dept_id
        ).order_by(DeptRoleModel.role_name).all()
        return [{"role_name": r.role_name, "include_subtree": bool(r.include_subtree)} for r in rows]


def set_dept_roles(dept_id, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """整体替换某部门的继承角色映射。items: [{role_name, include_subtree}]。"""
    from chayuan.server.db.models.dept_role_model import DeptRoleModel
    norm = []
    seen = set()
    for it in (items or []):
        name = str((it or {}).get("role_name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        norm.append((name, bool((it or {}).get("include_subtree"))))
    with session_scope() as s:
        s.query(DeptRoleModel).filter(DeptRoleModel.dept_id == dept_id).delete()
        for name, inc in norm:
            s.add(DeptRoleModel(dept_id=dept_id, role_name=name, include_subtree=inc))
    return [{"role_name": n, "include_subtree": i} for n, i in norm]
```
- [ ] **Step 4** 跑测试确认 PASS（4 条）。注意：`effective_roles` 已在 P2-T3 实现，本 task 只新增 dept_roles 读写；若 effective_roles 对部门继承的处理有 bug，这里的测试会抓出来——那就修 user_role_repository.effective_roles，别改测试。
- [ ] **Step 5** Commit（`feat(org): dept_roles read/write + dept-inherited effective_roles tests`），stage dept_repository.py + 新测试文件。

---

## Task P2-T5: service 层（create_user 扩 dept_id/roles + set_user_dept + soft delete）

**Files:** Modify `SRV/auth/service.py`; Test `LIB/tests/unit_tests/test_user_service_p2.py`

- [ ] **Step 1** 写测试 `test_user_service_p2.py`:
```python
from __future__ import annotations
import pytest
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import user_role_repository as urr


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.setenv("CHAYUAN_SEAT_DISABLED", "1")  # 关席位上限,聚焦本测试
    def _purge():
        with session_scope() as s:
            s.query(UserRoleModel).delete(); s.query(UserModel).delete()
    _purge(); yield; _purge()


def test_create_user_with_roles_and_dept():
    u = svc.create_user("u1", "secret123", roles=["user", "admin"], dept_id=None)
    assert set(urr.get_user_roles(u.id)) == {"user", "admin"}
    assert u.role == "admin"  # primary


def test_create_user_legacy_role_still_works():
    u = svc.create_user("u2", "secret123", role="user")
    assert urr.get_user_roles(u.id) == ["user"]


def test_set_user_dept():
    u = svc.create_user("u3", "secret123")
    svc.set_user_dept(u.id, 42)
    with session_scope() as s:
        assert s.query(UserModel).filter(UserModel.id == u.id).one().dept_id == 42


def test_soft_delete_user():
    u = svc.create_user("u4", "secret123")
    svc.soft_delete_user(u.id)
    with session_scope() as s:
        assert s.query(UserModel).filter(UserModel.id == u.id).one().is_active is False
```

- [ ] **Step 2** 跑确认 FAIL。
- [ ] **Step 3** 改 `SRV/auth/service.py`：
  (a) `create_user` 签名增 `roles: Optional[List[str]] = None` 和 `dept_id: Optional[int] = None`（保留现有 `role` 参数兼容）。文件顶部确保 `from typing import List, Optional`。
  (b) 角色解析：`role_names = roles if roles else [role]`（role 默认 "user"）；用现有的"未知角色回退"逻辑对每个名校验（保留现有对单 role 的处理，扩成对列表）。
  (c) 建 user 时设 `dept_id=dept_id`，主角色 `role=_primary(role_names)`（admin 优先，否则第一个，否则 "user"）。仍调 `assert_seat_available()`（不绕过席位）。
  (d) flush 后、expunge 前或之后，调 `user_role_repository.set_user_roles(u.id, role_names)` 写多角色（注意 set_user_roles 内部开新 session，需在外层 session 提交后调用——简单做法:create_user 的 session 块结束返回 u 后，再调 set_user_roles(u.id, role_names)，最后返回 u）。
  具体实现（替换现有 create_user，保持其余函数不变）：
```python
def create_user(
    username: str,
    password: str,
    *,
    role: str = "user",
    roles: Optional[List[str]] = None,
    email: Optional[str] = None,
    dept_id: Optional[int] = None,
) -> UserModel:
    username = (username or "").strip()
    if not username:
        raise ValueError("username required")
    if len(username) > 64:
        raise ValueError("username too long")
    if len(password) < 6:
        raise ValueError("password too short (>= 6)")

    # 角色列表:roles 优先,否则单 role;逐个对已存在角色校验,未知丢弃;空 → ["user"]
    raw = list(roles) if roles else [role]
    valid: List[str] = []
    for r in raw:
        r = (r or "").strip()
        if not r:
            continue
        if r in ("admin", "user"):
            if r not in valid:
                valid.append(r)
            continue
        try:
            from chayuan.server.db.repository import role_repository as _roles
            if _roles.get_role(r) is not None and r not in valid:
                valid.append(r)
        except Exception:  # noqa: BLE001
            pass
    if not valid:
        valid = ["user"]
    primary = "admin" if "admin" in valid else valid[0]

    from chayuan.server.license.seat import assert_seat_available
    assert_seat_available()

    pw = hash_password(password)
    try:
        with session_scope() as s:
            u = UserModel(
                username=username, email=email, password_hash=pw,
                role=primary, is_active=True, dept_id=dept_id,
            )
            s.add(u)
            s.flush()
            s.refresh(u)
            s.expunge(u)
    except IntegrityError as e:
        raise ValueError(f"username '{username}' already exists") from e

    from chayuan.server.db.repository import user_role_repository as urr
    urr.set_user_roles(u.id, valid)
    return u


def set_user_dept(user_id: int, dept_id: Optional[int]) -> None:
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.id == user_id).one_or_none()
        if u is None:
            raise ValueError("user not found")
        u.dept_id = dept_id


def soft_delete_user(user_id: int) -> None:
    """软删:停用账号(保留数据与角色)。"""
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.id == user_id).one_or_none()
        if u is None:
            raise ValueError("user not found")
        u.is_active = False
```
- [ ] **Step 4** 跑确认 PASS（4 条）。同时跑回归 `test_seat_create_user.py`（create_user 兼容）确认仍 3 passed。
- [ ] **Step 5** Commit（`feat(org): service create_user(dept_id/roles) + set_user_dept + soft_delete_user`），stage service.py + 新测试。

---

## Task P2-T6: 路由层（用户 API 扩展 + me/modules 升级 + 部门角色/成员端点）

**Files:** Modify `SRV/api_server/auth_routes.py`、`SRV/api_server/orgs_routes.py`; Test `LIB/tests/unit_tests/test_p2_routes.py`

- [ ] **Step 1** 写测试 `test_p2_routes.py`:
```python
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.dept_role_model import DeptRoleModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.orgs_routes import orgs_router, depts_router, _ADMIN as DADMIN
from chayuan.server.api_server.auth_routes import auth_router
from chayuan.server.auth.deps import get_current_user


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CHAYUAN_SEAT_DISABLED", "1")
    with session_scope() as s:
        for M in (DeptRoleModel, UserRoleModel, UserModel, DepartmentModel, OrganizationModel):
            s.query(M).delete()
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(orgs_router)
    app.include_router(depts_router)
    # admin 身份注入(auth_router 用 require_role("admin") = 依赖 get_current_user;
    # 直接覆盖 get_current_user 返回 admin dict)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1, "username": "admin1", "role": "admin"}
    app.dependency_overrides[DADMIN] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def _prefix(client):
    # auth_router 的 prefix(可能是 /auth)由实现决定;探测其一
    return ""


def test_create_user_with_dept_and_roles(client):
    # 建组织/部门
    org = client.post("/api/v1/admin/orgs", json={"name": "o", "code": "o"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "研发"}).json()["data"]
    r = client.post("/auth/users", json={"username": "zhang", "password": "secret123",
                                         "roles": ["user"], "dept_id": dept["id"]})
    assert r.status_code in (200, 201)
    body = r.json()
    assert body["dept_id"] == dept["id"]
    assert "user" in body["roles"]


def test_put_user_roles(client):
    r = client.post("/auth/users", json={"username": "li", "password": "secret123"})
    uid = r.json()["id"]
    r2 = client.put(f"/auth/users/{uid}/roles", json={"roles": ["user", "admin"]})
    assert r2.status_code == 200
    me = client.get("/auth/users").json()
    row = [u for u in me if u["id"] == uid][0]
    assert set(row["roles"]) == {"user", "admin"}


def test_patch_user_dept(client):
    org = client.post("/api/v1/admin/orgs", json={"name": "o2", "code": "o2"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "销售"}).json()["data"]
    uid = client.post("/auth/users", json={"username": "w", "password": "secret123"}).json()["id"]
    r = client.patch(f"/auth/users/{uid}/dept", json={"dept_id": dept["id"]})
    assert r.status_code == 200


def test_dept_roles_endpoint(client):
    org = client.post("/api/v1/admin/orgs", json={"name": "o3", "code": "o3"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "x"}).json()["data"]
    r = client.put(f"/api/v1/admin/depts/{dept['id']}/roles",
                   json={"roles": [{"role_name": "user", "include_subtree": True}]})
    assert r.status_code == 200
    got = client.get(f"/api/v1/admin/depts/{dept['id']}/roles").json()["data"]["roles"]
    assert got[0]["role_name"] == "user" and got[0]["include_subtree"] is True


def test_dept_members_endpoint(client):
    org = client.post("/api/v1/admin/orgs", json={"name": "o4", "code": "o4"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "m"}).json()["data"]
    client.post("/auth/users", json={"username": "mem1", "password": "secret123", "dept_id": dept["id"]})
    r = client.get(f"/api/v1/admin/depts/{dept['id']}/members")
    assert r.status_code == 200
    members = r.json()["data"]["members"]
    assert any(m["username"] == "mem1" for m in members)
```

- [ ] **Step 2** 跑确认 FAIL。
- [ ] **Step 3** 改 `SRV/api_server/auth_routes.py`：
  (a) `_CreateUserBody`（Pydantic 模型，文件内）增字段：`dept_id: Optional[int] = None`、`roles: Optional[List[str]] = None`（确保 import List/Optional）。
  (b) `admin_create_user` 调用改：`svc.create_user(body.username, body.password, role=body.role, roles=body.roles, email=body.email, dept_id=body.dept_id)`；返回值改用下面的 `_user_public(u)` 以带上 roles。
  (c) 新增私有 helper（放文件合适位置）：
```python
def _user_public(u) -> "UserPublicSchema":
    from chayuan.server.db.repository import user_role_repository as urr
    data = UserPublicSchema.model_validate(u).model_dump()
    data["roles"] = urr.get_user_roles(int(u.id))
    data["dept_id"] = getattr(u, "dept_id", None)
    return UserPublicSchema.model_validate(data)
```
  (d) `admin_list_users` / `me` / `admin_create_user` 返回都改成 `_user_public(u)`（list 用列表推导）。
  (e) 新增端点：
```python
class _SetRolesBody(BaseModel):
    roles: List[str] = []

@auth_router.put("/users/{user_id}/roles", summary="[admin] 设置用户多角色")
def set_user_roles_route(user_id: int, body: _SetRolesBody, _=Depends(require_role("admin"))):
    from chayuan.server.db.repository import user_role_repository as urr
    urr.set_user_roles(user_id, body.roles)
    return {"code": 0, "msg": "ok", "data": {"roles": urr.get_user_roles(user_id)}}


class _SetDeptBody(BaseModel):
    dept_id: Optional[int] = None

@auth_router.patch("/users/{user_id}/dept", summary="[admin] 设置用户所属部门")
def set_user_dept_route(user_id: int, body: _SetDeptBody, _=Depends(require_role("admin"))):
    try:
        svc.set_user_dept(user_id, body.dept_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"code": 0, "msg": "ok"}


@auth_router.delete("/users/{user_id}", summary="[admin] 软删用户(停用)")
def delete_user_route(user_id: int, _=Depends(require_role("admin"))):
    try:
        svc.soft_delete_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"code": 0, "msg": "ok"}
```
  (f) `my_modules` 升级（替换其计算 modules 的部分）——基于有效角色：
```python
@auth_router.get("/me/modules", summary="当前用户可见的模块(后台 + 前端功能,RBAC #2)")
def my_modules(user: Dict[str, Any] = Depends(get_current_user)):
    from chayuan.server.db.repository import role_repository as repo
    uid = int(user.get("id") or 0)
    if uid > 0:
        from chayuan.server.db.repository import user_role_repository as urr
        full = svc.get_user_by_id(uid)
        dept_id = getattr(full, "dept_id", None) if full else None
        eff_roles = urr.effective_roles(uid, dept_id)
        if not eff_roles:
            eff_roles = [str(user.get("role") or "user")]
    else:
        eff_roles = [str(user.get("role") or "user")]  # 游客:用其默认角色
    modules = repo.effective_modules_multi(eff_roles)
    primary = "admin" if "admin" in eff_roles else (eff_roles[0] if eff_roles else "user")
    try:
        from chayuan.server.profiles import is_single_machine
        single_machine = bool(is_single_machine())
    except Exception:  # noqa: BLE001
        single_machine = False
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "role": primary,
            "roles": eff_roles,
            "is_admin": "admin" in eff_roles,
            "is_guest": bool(user.get("is_guest")),
            "single_machine": single_machine,
            "modules": modules,
        },
    }
```
  （确保文件已 import `BaseModel`、`List`、`Optional`、`Depends`、`HTTPException`、`require_role`、`svc`、`get_current_user`——大多已在；缺的补。）

- [ ] **Step 4** 改 `SRV/api_server/orgs_routes.py`，给 `depts_router` 加两个端点：
```python
class _DeptRolesBody(BaseModel):
    roles: list = []

@depts_router.put("/{dept_id}/roles", summary="[admin] 设置部门继承角色")
def set_dept_roles_route(dept_id: int, body: "_DeptRolesBody", _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    saved = repo.set_dept_roles(dept_id, body.roles)
    return {"code": 0, "msg": "ok", "data": {"roles": saved}}

@depts_router.get("/{dept_id}/roles", summary="[admin] 部门继承角色")
def get_dept_roles_route(dept_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    return {"code": 0, "msg": "ok", "data": {"roles": repo.get_dept_roles(dept_id)}}

@depts_router.get("/{dept_id}/members", summary="[admin] 部门成员")
def dept_members_route(dept_id: int, include_subtree: bool = False, keyword: str = "",
                       _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    from chayuan.server.db.repository import user_role_repository as urr
    from chayuan.server.db.models.user_model import UserModel
    from chayuan.server.db.session import session_scope
    dept_ids = repo.subtree_ids(dept_id) if include_subtree else [dept_id]
    with session_scope() as s:
        q = s.query(UserModel).filter(UserModel.dept_id.in_(dept_ids))
        if keyword:
            like = f"%{keyword}%"
            q = q.filter(UserModel.username.like(like))
        rows = q.order_by(UserModel.id).all()
        members = [{"id": u.id, "username": u.username, "email": u.email,
                    "dept_id": u.dept_id, "is_active": bool(u.is_active),
                    "roles": urr.get_user_roles(u.id)} for u in rows]
    return {"code": 0, "msg": "ok", "data": {"members": members}}
```
  （orgs_routes.py 顶部需 import `BaseModel`：加 `from pydantic import BaseModel`。`_DeptRolesBody.roles` 用 `list` 接 `[{role_name, include_subtree}]`。）

- [ ] **Step 5** 跑 `test_p2_routes.py` 确认 PASS（5 条）。`auth_router` 的 prefix：测试里用的是 `/auth/...`——若实际 prefix 不同，先 grep `auth_router = APIRouter(` 确认 prefix 再对齐测试路径。
- [ ] **Step 6** Commit（`feat(org): P2 routes — user dept/roles + me/modules effective_roles + dept roles/members`），stage auth_routes.py + orgs_routes.py + 新测试。

---

## Task P2-T7: P2 收尾验证

- [ ] **Step 1** 跑 P2 全量 + 回归：
```
$RECIPE 跑: test_user_role_repository.py test_dept_roles_inherit.py test_user_service_p2.py test_p2_routes.py
         + 回归 test_org_dept_repository.py test_org_dept_routes.py test_seat_create_user.py test_admin_users_routes.py
```
全 PASS。
- [ ] **Step 2** 单机零影响自查：me/modules 对 guest(id=-1) 走"用其默认角色"分支不查库;create_user 仍过席位;require_role("admin") 单机 guest 天然 403。无单机代码改动。
- [ ] **Step 3** 报告 P2 完成（不在此 commit bump/push，由 controller 统一处理或留 P6）。

## 自查
- Spec 覆盖:user_roles+dept_roles+users.dept_id(T1/T2)、多角色读写+主角色同步(T3)、effective_roles 部门继承(T3 实现+T4 测试)、effective_modules_multi(T3)、create_user 扩展(T5)、me/modules 升级(T6)、用户 dept/roles 端点+部门角色/成员端点(T6)。回填(T2)。
- 向后兼容:UserPublicSchema 加可选字段;create_user 保留 role 参数;me/modules 保留 role/is_admin/modules 字段;前端 MyModules 无需改。
- role_name 作键(非 role_id)——与代码库一致,已在计划顶部说明。

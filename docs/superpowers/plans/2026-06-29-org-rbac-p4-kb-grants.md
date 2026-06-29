# 知识库授权泛化（P4）实施计划

> 每个 Task 一个 subagent，TDD。仓库根 /work/chayuan-desktop，分支 main，直接在 main 上做。

**Goal:** KB 授权从「只能授给单个用户 reader/editor」泛化成「授给 用户/角色/部门(可含子树)」，判定接进现有 `kb_access_for` 热路径，保留所有既有行为(app_acl 短路 / admin owner / owner_id / 公开可见 / legacy KB)。

## 通用约定（同前）
- root 所有：git/写源码需 sudo（新文件 scratchpad temp + `sudo cp` + `sudo chown root:root`）。tests 目录直接写。只 stage 本 task 文件。不 push、不 bump（留 P4-T5）。
- 角色键 role_name；commit message 末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- `SRV/`=`chayuan-server/libs/chayuan-server/chayuan/server/`，`LIB/`=`chayuan-server/libs/chayuan-server/`。

## 测试环境配方
解释器 `/tmp/agentvenv/bin/python`。每 task 独立 root：
```
cd /work/chayuan-desktop/chayuan-server
export CHAYUAN_ROOT="/tmp/claude-1000/-work-chayuan-desktop/3906fece-2bc2-4715-935c-d94ab837060a/scratchpad/p4t<N>_root" && mkdir -p "$CHAYUAN_ROOT"
PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -c "import chayuan.server.db.models; from chayuan.server.db.base import Base; from chayuan.server.db.session import SessionLocal; Base.metadata.create_all(SessionLocal().get_bind())"
PYTHONPATH="libs/chayuan-server" /tmp/agentvenv/bin/python -m pytest -o addopts="" -p no:cacheprovider -q <tests>
```

## 现状（探索结论，逐字依据）
- grant 表 `kb_access_grants`(KBAccessGrantModel): id/kb_id/user_id/role(reader|editor)/granted_at/granted_by，unique(kb_id,user_id)。`SRV/db/models/kb_access_model.py`。
- KB `KnowledgeBaseModel`: id/kb_name/owner_id/visibility(private|public)。
- 判定 `kb_access_for(user, kb_name)` 在 `SRV/auth/access.py:47-85`：app_acl 短路 → 取 kb → admin 返回 owner → owner_id==uid 返回 owner → legacy(owner_id None)→reader → `_grant_role(kb.id, uid)` → public→reader → None。**只改 `_grant_role(kb.id, uid)` 这一处**为多主体解析。
- 授权服务 `grant_kb_access/revoke_kb_access/list_kb_grants` 在 `SRV/auth/service.py:228-263`。
- 路由 `kb_acl_routes.py`: GET/POST/DELETE grants + PATCH visibility/owner。

## 设计：新表 kb_subject_grants（不动旧表，避开 unique(kb_id,user_id)）
```
kb_subject_grants
  id, kb_id INT,
  subject_type STR(8)  # 'user' | 'role' | 'dept'
  subject_id   STR(64) # user→str(user_id), dept→str(dept_id), role→role_name
  role         STR(16) # reader | editor
  include_subtree BOOL # 仅 dept 有意义
  granted_by INT 可空, granted_at DATETIME
  UNIQUE(kb_id, subject_type, subject_id)
```
迁移把 `kb_access_grants` 存量行拷成 subject_type='user', subject_id=CAST(user_id AS TEXT)。判定/路由全切到新表，旧表保留不动(legacy,不再读写)。

## 判定语义（kb_access_for 内多主体解析）
```
_grant_role_multi(kb_id, user) -> reader|editor|None:
  grants = 该 kb 的 kb_subject_grants 全部
  若空 → None
  uid = user.id; best = None  (editor 优先于 reader)
  # 用户直接授权
  对 type=='user' 且 subject_id==str(uid) → best = max(best, role)
  # 仅当存在 role/dept 授权才查 effective_roles/部门链(省热路径开销)
  若存在 type in ('role','dept') 的 grant:
     eff = user_role_repository.effective_roles(uid, dept_id)   # dept_id 来自 get_user_by_id(uid).dept_id
     对 type=='role' 且 subject_id in eff → best = max(best, role)
     chain = 用户所在部门的 ancestors(自包含 id 集)
     对 type=='dept':
         D = int(subject_id)
         若 D in chain 且 (D==dept_id 或 include_subtree) → best = max(best, role)
  return best
```
在 `kb_access_for` 里把 `role = _grant_role(kb.id, uid)` 换成 `role = _grant_role_multi(kb.id, user)`（保留其前后所有逻辑）。

---

## Task P4-T1: ORM + 迁移 0031（kb_subject_grants 表 + 迁移存量）

**Files:** Create `SRV/db/models/kb_subject_grant_model.py`; Modify `SRV/db/models/__init__.py`; Create `SRV/db/alembic/versions/0031_kb_subject_grants.py`

- [ ] **Step 1** 写 `SRV/db/models/kb_subject_grant_model.py`:
```python
"""KB 授权(泛化主体) ORM —— 主体可为 用户/角色/部门。

subject_type: 'user'|'role'|'dept'; subject_id: user→str(uid), dept→str(dept_id), role→role_name。
include_subtree 仅 dept 有意义(是否含下级部门)。owner 仍由 knowledge_base.owner_id 给。
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint, func

from chayuan.server.db.base import Base


class KbSubjectGrantModel(Base):
    __tablename__ = "kb_subject_grants"
    __table_args__ = (
        UniqueConstraint("kb_id", "subject_type", "subject_id", name="uq_kb_subject_grant"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    kb_id = Column(Integer, nullable=False, index=True, comment="knowledge_base.id")
    subject_type = Column(String(8), nullable=False, comment="user|role|dept")
    subject_id = Column(String(64), nullable=False, comment="user→uid, dept→dept_id, role→role_name")
    role = Column(String(16), default="reader", nullable=False, comment="reader|editor")
    include_subtree = Column(Boolean, nullable=False, default=False, comment="dept 是否含下级")
    granted_by = Column(Integer, nullable=True, comment="授予者 users.id")
    granted_at = Column(DateTime, default=func.now())
```
- [ ] **Step 2** `SRV/db/models/__init__.py` 末尾追加：
```python
from chayuan.server.db.models import kb_subject_grant_model  # noqa: F401
```
- [ ] **Step 3** 写迁移 `SRV/db/alembic/versions/0031_kb_subject_grants.py`（down_revision=当前头 `0030_role_data_scope`）:
```python
"""KB 授权泛化:kb_subject_grants 表 + 迁移存量 user 授权(P4 org-RBAC)。

新增 kb_subject_grants(主体 user/role/dept);把旧 kb_access_grants 的 user 授权
拷成 subject_type='user'。旧表保留不动。两种建表模式都安全。

Revision ID: 0031_kb_subject_grants
Revises: 0030_role_data_scope
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0031_kb_subject_grants"
down_revision = "0030_role_data_scope"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _has_table("kb_subject_grants"):
        op.create_table(
            "kb_subject_grants",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("kb_id", sa.Integer(), nullable=False),
            sa.Column("subject_type", sa.String(length=8), nullable=False),
            sa.Column("subject_id", sa.String(length=64), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False, server_default="reader"),
            sa.Column("include_subtree", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("granted_by", sa.Integer(), nullable=True),
            sa.Column("granted_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("kb_id", "subject_type", "subject_id", name="uq_kb_subject_grant"),
        )
        op.create_index("ix_kb_subject_grants_kb_id", "kb_subject_grants", ["kb_id"])

    # 迁移存量 user 授权(幂等:仅插不存在的)
    if _has_table("kb_access_grants"):
        bind = op.get_bind()
        bind.execute(sa.text(
            "INSERT INTO kb_subject_grants (kb_id, subject_type, subject_id, role, include_subtree, granted_by) "
            "SELECT g.kb_id, 'user', CAST(g.user_id AS CHAR), g.role, 0, g.granted_by "
            "FROM kb_access_grants g "
            "WHERE NOT EXISTS (SELECT 1 FROM kb_subject_grants k "
            "  WHERE k.kb_id = g.kb_id AND k.subject_type = 'user' AND k.subject_id = CAST(g.user_id AS CHAR))"
        ))


def downgrade() -> None:
    if _has_table("kb_subject_grants"):
        op.drop_table("kb_subject_grants")
```
注：`CAST(... AS CHAR)` 在 sqlite/postgres/mysql 都可用；若某后端报错可改 `CAST(... AS TEXT)`——验证时若 sqlite 用 CHAR 报错就改 TEXT 并在两处保持一致。
- [ ] **Step 4** 冒烟(`kb_subject_grants` in metadata) + 头唯一 + py_compile + 应用验证(fresh root stamp 0030 → upgrade head；建一个含 kb_access_grants 且有一行 user 授权的库,验证迁移把它拷进 kb_subject_grants 为 subject_type='user')。沿用前几期 migrator 验证方式。
- [ ] **Step 5** Commit（`feat(org): P4 ORM+migration — kb_subject_grants + migrate user grants`），stage 3 文件。

---

## Task P4-T2: kb_grant_repository（泛化主体读写）

**Files:** Create `SRV/db/repository/kb_grant_repository.py`; Test `LIB/tests/unit_tests/test_kb_grant_repository.py`

- [ ] **Step 1** 写测试 `test_kb_grant_repository.py`:
```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import kb_grant_repository as kg


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(KbSubjectGrantModel).delete()
    _purge(); yield; _purge()


def test_add_and_list_user_grant():
    kg.add_grant(1, "user", "5", "reader", granted_by=9)
    rows = kg.list_grants(1)
    assert len(rows) == 1
    assert rows[0]["subject_type"] == "user" and rows[0]["subject_id"] == "5" and rows[0]["role"] == "reader"


def test_add_upserts_role():
    kg.add_grant(1, "dept", "3", "reader", include_subtree=True)
    kg.add_grant(1, "dept", "3", "editor", include_subtree=True)  # 同主体再授 → 升级
    rows = kg.list_grants(1)
    assert len(rows) == 1 and rows[0]["role"] == "editor" and rows[0]["include_subtree"] is True


def test_revoke_grant():
    kg.add_grant(1, "role", "mgr", "editor")
    kg.revoke_grant(1, "role", "mgr")
    assert kg.list_grants(1) == []


def test_invalid_role_rejected():
    with pytest.raises(ValueError):
        kg.add_grant(1, "user", "5", "owner")


def test_invalid_subject_type_rejected():
    with pytest.raises(ValueError):
        kg.add_grant(1, "group", "5", "reader")
```
- [ ] **Step 2** 跑确认 FAIL。
- [ ] **Step 3** 写 `SRV/db/repository/kb_grant_repository.py`:
```python
"""KB 泛化授权仓库（主体 user/role/dept）。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope

_SUBJECT_TYPES = ("user", "role", "dept")
_ROLES = ("reader", "editor")


def add_grant(kb_id: int, subject_type: str, subject_id: str, role: str,
              include_subtree: bool = False, granted_by: Optional[int] = None) -> Dict[str, Any]:
    if subject_type not in _SUBJECT_TYPES:
        raise ValueError("subject_type 必须是 user/role/dept")
    if role not in _ROLES:
        raise ValueError("role 必须是 reader/editor")
    subject_id = str(subject_id)
    with session_scope() as s:
        g = s.query(KbSubjectGrantModel).filter(
            KbSubjectGrantModel.kb_id == kb_id,
            KbSubjectGrantModel.subject_type == subject_type,
            KbSubjectGrantModel.subject_id == subject_id,
        ).one_or_none()
        if g is None:
            g = KbSubjectGrantModel(kb_id=kb_id, subject_type=subject_type, subject_id=subject_id)
            s.add(g)
        g.role = role
        g.include_subtree = bool(include_subtree)
        g.granted_by = granted_by
        s.flush()
        return _to_dict(g)


def revoke_grant(kb_id: int, subject_type: str, subject_id: str) -> bool:
    with session_scope() as s:
        n = s.query(KbSubjectGrantModel).filter(
            KbSubjectGrantModel.kb_id == kb_id,
            KbSubjectGrantModel.subject_type == subject_type,
            KbSubjectGrantModel.subject_id == str(subject_id),
        ).delete(synchronize_session=False)
        return bool(n)


def list_grants(kb_id: int) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.query(KbSubjectGrantModel).filter(KbSubjectGrantModel.kb_id == kb_id).all()
        return [_to_dict(g) for g in rows]


def _to_dict(g: "KbSubjectGrantModel") -> Dict[str, Any]:
    return {
        "subject_type": g.subject_type,
        "subject_id": g.subject_id,
        "role": g.role,
        "include_subtree": bool(g.include_subtree),
        "granted_by": g.granted_by,
    }
```
- [ ] **Step 4** 跑确认 PASS（5 条）。
- [ ] **Step 5** Commit（`feat(org): kb_grant_repository (user/role/dept subjects)`），stage 2 文件。

---

## Task P4-T3: kb_access_for 多主体判定（核心，security-critical）

**Files:** Modify `SRV/auth/access.py`; Test `LIB/tests/unit_tests/test_kb_access_multi.py`

- [ ] **Step 1** 写测试 `test_kb_access_multi.py`（直接建 KB + 用户 + 部门 + grant，断言 kb_access_for 结果）:
```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import org_repository as orgs
from chayuan.server.db.repository import dept_repository as depts
from chayuan.server.db.repository import kb_grant_repository as kg
from chayuan.server.db.repository import user_role_repository as urr
from chayuan.server.auth.access import kb_access_for


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            for M in (KbSubjectGrantModel, UserRoleModel, UserModel,
                      KnowledgeBaseModel, DepartmentModel, OrganizationModel):
                s.query(M).delete()
    _purge(); yield; _purge()


def _kb(name="kb1", owner_id=None, vis="private"):
    with session_scope() as s:
        kb = KnowledgeBaseModel(kb_name=name, owner_id=owner_id, visibility=vis)
        s.add(kb); s.flush(); kid = kb.id; s.expunge(kb)
        return kid, name


def _user(dept_id=None, roles=("user",)):
    with session_scope() as s:
        u = UserModel(username="zhang", password_hash="x", role=roles[0], is_active=True, dept_id=dept_id)
        s.add(u); s.flush(); s.refresh(u); s.expunge(u); uid = u.id
    urr.set_user_roles(uid, list(roles))
    return uid


def _U(uid, role="user"):
    return {"id": uid, "username": "zhang", "role": role}


def test_user_direct_grant():
    kid, name = _kb()
    uid = _user()
    kg.add_grant(kid, "user", str(uid), "editor")
    assert kb_access_for(_U(uid), name) == "editor"


def test_role_grant():
    kid, name = _kb()
    uid = _user(roles=("user", "sales"))
    kg.add_grant(kid, "role", "sales", "reader")
    assert kb_access_for(_U(uid), name) == "reader"


def test_dept_grant_direct_member():
    o = orgs.create_org("o", "o")
    d = depts.create_dept(o["id"], None, "研发")
    kid, name = _kb()
    uid = _user(dept_id=d["id"])
    kg.add_grant(kid, "dept", str(d["id"]), "editor", include_subtree=False)
    assert kb_access_for(_U(uid), name) == "editor"


def test_dept_grant_subtree_inherits():
    o = orgs.create_org("o", "o")
    parent = depts.create_dept(o["id"], None, "总部")
    child = depts.create_dept(o["id"], parent["id"], "小组")
    kid, name = _kb()
    uid = _user(dept_id=child["id"])
    kg.add_grant(kid, "dept", str(parent["id"]), "reader", include_subtree=True)
    assert kb_access_for(_U(uid), name) == "reader"


def test_dept_grant_no_subtree_does_not_inherit():
    o = orgs.create_org("o", "o")
    parent = depts.create_dept(o["id"], None, "总部")
    child = depts.create_dept(o["id"], parent["id"], "小组")
    kid, name = _kb()
    uid = _user(dept_id=child["id"])
    kg.add_grant(kid, "dept", str(parent["id"]), "reader", include_subtree=False)
    # 上级未开子树 → 子部门成员不继承;private KB 无其它授权 → None
    assert kb_access_for(_U(uid), name) is None


def test_editor_beats_reader_across_subjects():
    kid, name = _kb()
    uid = _user(roles=("user", "sales"))
    kg.add_grant(kid, "user", str(uid), "reader")
    kg.add_grant(kid, "role", "sales", "editor")
    assert kb_access_for(_U(uid), name) == "editor"


def test_admin_still_owner():
    kid, name = _kb()
    assert kb_access_for({"id": 999, "role": "admin"}, name) == "owner"


def test_public_still_reader_without_grant():
    kid, name = _kb(vis="public")
    uid = _user()
    assert kb_access_for(_U(uid), name) == "reader"
```
- [ ] **Step 2** 跑确认 FAIL（role/dept 授权尚未被 kb_access_for 识别 → 多条 FAIL）。
- [ ] **Step 3** 改 `SRV/auth/access.py`：
  (a) 先 READ 现有 access.py，确认 `_grant_role(kb_id, uid)` 与 `kb_access_for` 的确切上下文。
  (b) 新增多主体解析函数（放在 `_grant_role` 附近）：
```python
def _ancestors_set(ancestors):
    if not ancestors:
        return set()
    return {int(x) for x in str(ancestors).split(",") if x.strip().isdigit()}


def _grant_role_multi(kb_id, user):
    """多主体(user/role/dept)聚合,返回 'editor'|'reader'|None。editor 优先。"""
    from chayuan.server.db.repository import kb_grant_repository as kg
    grants = kg.list_grants(int(kb_id))
    if not grants:
        return None
    uid = (user.get("id") if isinstance(user, dict) else getattr(user, "id", None)) if user else None
    rank = {"reader": 1, "editor": 2}
    best = 0

    def _bump(r):
        nonlocal best
        best = max(best, rank.get(r, 0))

    # 用户直接授权
    if uid is not None:
        sid = str(uid)
        for g in grants:
            if g["subject_type"] == "user" and g["subject_id"] == sid:
                _bump(g["role"])

    # 仅当存在 role/dept 授权才查有效角色/部门链(省热路径开销)
    has_rd = any(g["subject_type"] in ("role", "dept") for g in grants)
    if has_rd and uid is not None and uid > 0:
        from chayuan.server.db.repository import user_role_repository as urr
        from chayuan.server.auth import service as _svc
        full = _svc.get_user_by_id(int(uid))
        dept_id = getattr(full, "dept_id", None) if full else None
        eff = set(urr.effective_roles(int(uid), dept_id))
        for g in grants:
            if g["subject_type"] == "role" and g["subject_id"] in eff:
                _bump(g["role"])
        if dept_id is not None:
            from chayuan.server.db.repository import dept_repository as dr
            d = dr.get_dept(int(dept_id))
            chain = _ancestors_set(d["ancestors"]) if d else {int(dept_id)}
            for g in grants:
                if g["subject_type"] != "dept":
                    continue
                try:
                    gd = int(g["subject_id"])
                except (TypeError, ValueError):
                    continue
                if gd in chain and (gd == int(dept_id) or g["include_subtree"]):
                    _bump(g["role"])

    return {2: "editor", 1: "reader"}.get(best)
```
  (c) 在 `kb_access_for` 里把 `role = _grant_role(kb.id, uid)` 这一行换成 `role = _grant_role_multi(kb.id, user)`（保留其上下文 `if role: return role`）。其余逻辑(app_acl/admin/owner/legacy/public)一字不动。
- [ ] **Step 4** 跑测试确认 PASS（8 条）+ 回归 `test_kb_acl_decisions.py`（app_acl 路径不受影响,应仍绿）。
- [ ] **Step 5** Commit（`feat(org): kb_access_for resolves user/role/dept(+subtree) grants`），stage 2 文件。

---

## Task P4-T4: kb_acl_routes 泛化

**Files:** Modify `SRV/api_server/kb_acl_routes.py`; Test `LIB/tests/unit_tests/test_kb_acl_routes_multi.py`

- [ ] **Step 1** 写测试（TestClient 调路由）`test_kb_acl_routes_multi.py`:
```python
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.kb_acl_routes import kb_acl_router


@pytest.fixture
def client():
    with session_scope() as s:
        s.query(KbSubjectGrantModel).delete()
    app = FastAPI()
    app.include_router(kb_acl_router)
    return TestClient(app)


def _base():
    # kb_acl_router 的 prefix 由实现决定;测试前先探测(grep)并把下面前缀替换正确
    return ""


def test_add_role_grant_and_list(client):
    # 注:实际路径前缀见 kb_acl_router.prefix;以 /api/v1/admin/kb-acl 为例
    r = client.post("/api/v1/admin/kb-acl/1/grants",
                    json={"subject_type": "role", "subject_id": "sales", "role": "editor"})
    assert r.status_code == 200
    g = client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"]
    assert any(x["subject_type"] == "role" and x["subject_id"] == "sales" and x["role"] == "editor" for x in g)


def test_add_dept_grant_with_subtree(client):
    r = client.post("/api/v1/admin/kb-acl/1/grants",
                    json={"subject_type": "dept", "subject_id": "3", "role": "reader", "include_subtree": True})
    assert r.status_code == 200
    g = client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"]
    row = [x for x in g if x["subject_type"] == "dept"][0]
    assert row["include_subtree"] is True


def test_revoke_by_subject(client):
    client.post("/api/v1/admin/kb-acl/1/grants",
                json={"subject_type": "role", "subject_id": "sales", "role": "reader"})
    r = client.delete("/api/v1/admin/kb-acl/1/grants?subject_type=role&subject_id=sales")
    assert r.status_code == 200
    assert client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"] == []


def test_legacy_user_grant_still_works(client):
    # 兼容:只传 user_id 也能授(映射成 subject_type=user)
    r = client.post("/api/v1/admin/kb-acl/1/grants", json={"user_id": 7, "role": "reader"})
    assert r.status_code == 200
    g = client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"]
    assert any(x["subject_type"] == "user" and x["subject_id"] == "7" for x in g)
```
- [ ] **Step 2** 先 grep `kb_acl_router = APIRouter(` 确认 prefix（若不是 `/api/v1/admin/kb-acl` 则把测试里路径前缀改对）。跑确认 FAIL。
- [ ] **Step 3** 改 `SRV/api_server/kb_acl_routes.py`：
  - `GET /{kb_id}/grants`：改读 `kb_grant_repository.list_grants(kb_id)`；返回每条含 subject_type/subject_id/role/include_subtree；对 subject_type=='user' 附 `user`(用户名,用现有 `_users_lite()`),其它类型 `subject_id` 原样。保留旧返回里的 user/role 字段尽量兼容(user grant 仍带 user 名)。
  - `POST /{kb_id}/grants`：接受 `{subject_type, subject_id, role, include_subtree}`；**兼容**:若 body 只有 `user_id`(无 subject_type)则映射成 subject_type='user', subject_id=str(user_id)。调 `kb_grant_repository.add_grant(...)`，ValueError→400。
  - `DELETE /{kb_id}/grants`：改成 query 参 `subject_type`+`subject_id`，调 `revoke_grant`；**保留**旧路径 `DELETE /{kb_id}/grants/{user_id}` 作兼容(映射 subject_type='user')。
  - visibility/owner 端点不动。
- [ ] **Step 4** 跑测试确认 PASS（4 条）。
- [ ] **Step 5** Commit（`feat(org): kb-acl routes generalized to user/role/dept subjects`），stage 2 文件。

---

## Task P4-T5: P4 收尾（controller 跑）
- 全量 P1+P2+P3+P4 + 回归(尤其 test_kb_acl_decisions app_acl)全绿；bump+push。

## 自查
- Spec 覆盖:kb_subject_grants(T1)、grant repo 泛化(T2)、kb_access_for 多主体+子树(T3)、kb-acl 路由泛化+兼容(T4)、迁移存量(T1)。
- security:kb_access_for 只替换 `_grant_role` 一处,app_acl/admin/owner/legacy/public 全不动;role/dept 解析仅在有该类 grant 时触发(热路径省开销)。
- 兼容:旧 user_id grant API 仍可用(映射 user 主体);旧 kb_access_grants 表保留;迁移把存量拷进新表。

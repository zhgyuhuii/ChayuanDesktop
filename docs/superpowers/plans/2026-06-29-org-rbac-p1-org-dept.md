# 组织/部门基础（P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 chayuan-server 加上「组织 + 部门树」两张表及其 admin CRUD/move/tree API，作为后续多角色、数据权限、知识库按部门授权的地基。

**Architecture:** 原生 RuoYi 式：`organizations`（顶层平级组织）+ `departments`（组织下部门树，`ancestors` 自包含逗号路径做子树查询）。Repository 用现有 `session_scope()` 模式；路由 admin-only（`require_role("admin")`），返回 `{"code":0,"msg":"ok","data":...}` 信封；迁移走 Alembic 链式版本，幂等建表 + seed 默认组织。

**Tech Stack:** Python / FastAPI / SQLAlchemy（Column 声明式）/ Alembic / pytest（session_scope + TestClient + dependency_overrides）。

**范围说明（对 spec 的细化）：** spec 的 P1 概述把「所有新表 + users/roles 改列 + kb grants 泛化」都列在一期。本计划把 P1 收窄为**只建 organizations + departments 两张表及其 CRUD**——这是 P1 的代码真正用到的部分。`user_roles`/`dept_roles`/`role_scope_depts`、`users.dept_id`、`roles.data_scope`、kb grants 泛化各自放到用到它们的 P2/P3/P4 期，各带自己的 Alembic 迁移。这样每期自包含、可独立测试，避免给还没人用的表写迁移。

**通用约定（执行每个 commit 步骤时遵守）：**
- 本仓库根（/work/chayuan-desktop）归 root 所有，`git add/commit` 需 `sudo`（见 memory commit-procedure-chayuan-desktop）；只 stage 本计划列出的文件，别带 mode-bit 噪音。
- 改了程序代码的 commit 要 bump 版本号（VERSION + 3 个 tauri.conf + server pyproject，见 memory feedback_version_bump_on_commit）。本计划是纯服务端代码，按该规则 bump。
- 用户标准规则：每次有真实改动 commit 后直接 push origin/main（见 memory user-wants-commit-push-after-fixes）。目标分支固定 `main`。
- 测试用 root py312 环境（见 memory reference_py312_test_env），命令里写的是 `python -m pytest`，执行时按该环境用 `sudo -E <py312python>`。

**测试命令基底（下文用 `$PYTEST` 代指）：**
```
cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q
```

---

## 文件结构

**新建：**
- `chayuan-server/libs/chayuan-server/chayuan/server/db/models/org_model.py` — `OrganizationModel` ORM。
- `chayuan-server/libs/chayuan-server/chayuan/server/db/models/dept_model.py` — `DepartmentModel` ORM。
- `chayuan-server/libs/chayuan-server/chayuan/server/db/repository/org_repository.py` — 组织 CRUD。
- `chayuan-server/libs/chayuan-server/chayuan/server/db/repository/dept_repository.py` — 部门树 CRUD + ancestors 维护 + 子树 + move。
- `chayuan-server/libs/chayuan-server/chayuan/server/db/alembic/versions/0028_org_dept.py` — 建表 + seed 默认组织。
- `chayuan-server/libs/chayuan-server/chayuan/server/api_server/orgs_routes.py` — 组织 + 部门 admin 路由。
- `chayuan-server/libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py` — 仓库单测。
- `chayuan-server/libs/chayuan-server/tests/unit_tests/test_org_dept_routes.py` — 路由单测。

**修改：**
- `chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py` — 导入两个新 model（让 Base.metadata / alembic env 看到）。
- `chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py:65` 附近（import）与 `:189` 附近（include_router）— 注册两个 router。

> 路径前缀统一：下文 `SRV/` = `chayuan-server/libs/chayuan-server/chayuan/server/`，`LIB/` = `chayuan-server/libs/chayuan-server/`。

---

## Task 1: 新增 ORM 模型并注册

**Files:**
- Create: `SRV/db/models/org_model.py`
- Create: `SRV/db/models/dept_model.py`
- Modify: `SRV/db/models/__init__.py`

- [ ] **Step 1: 写 org_model.py**

```python
"""组织 ORM —— 顶层平级组织(多个分公司/事业部)。

组织是部门树的归属容器;部门挂在组织下。数据不强隔离,admin 跨组织可见。
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, Text, func

from chayuan.server.db.base import Base


class OrganizationModel(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=False, comment="组织名称")
    code = Column(String(32), unique=True, nullable=False, index=True, comment="组织编码(唯一)")
    order_num = Column(Integer, default=0, nullable=False, comment="排序")
    status = Column(String(16), default="active", nullable=False, comment="active/disabled")
    remark = Column(Text, nullable=True, comment="备注")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "order_num": int(self.order_num or 0),
            "status": self.status,
            "remark": self.remark or "",
        }
```

- [ ] **Step 2: 写 dept_model.py**

```python
"""部门 ORM —— 组织下的部门树。

ancestors: 自包含、逗号包裹的祖先路径(含自身 id),如根部门 ",5," 子部门 ",5,9,"。
子树查询用 `ancestors LIKE '%,<id>,%'`,逗号包裹避免 id 前缀误匹配
(",11," 不含子串 ",1,",因此查 dept 1 不会误命中 dept 11)。
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, func

from chayuan.server.db.base import Base


class DepartmentModel(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True, comment="所属组织 id")
    parent_id = Column(Integer, nullable=True, index=True, comment="父部门 id(根为 NULL)")
    ancestors = Column(String(255), default=",", nullable=False, comment="自包含逗号路径 ',5,9,'")
    name = Column(String(64), nullable=False, comment="部门名称")
    order_num = Column(Integer, default=0, nullable=False, comment="排序")
    leader_user_id = Column(Integer, nullable=True, comment="部门负责人用户 id")
    status = Column(String(16), default="active", nullable=False, comment="active/disabled")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "org_id": int(self.org_id),
            "parent_id": self.parent_id,
            "ancestors": self.ancestors or ",",
            "name": self.name,
            "order_num": int(self.order_num or 0),
            "leader_user_id": self.leader_user_id,
            "status": self.status,
        }
```

- [ ] **Step 3: 在 models/__init__.py 注册两个新 model**

打开 `SRV/db/models/__init__.py`，仿照里面已有的 model import 行（如 `role_model` 的导入），在末尾追加：

```python
from chayuan.server.db.models.org_model import OrganizationModel  # noqa: F401
from chayuan.server.db.models.dept_model import DepartmentModel  # noqa: F401
```

（alembic env.py 第 39 行 `import chayuan.server.db.models` + 测试 conftest 的 create_all 都靠这里把表登记进 `Base.metadata`。）

- [ ] **Step 4: 冒烟验证模型已登记进 metadata**

Run:
```
cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -c "import chayuan.server.db.models as m; from chayuan.server.db.base import Base; t=set(Base.metadata.tables); print('organizations' in t, 'departments' in t)"
```
Expected: `True True`

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/db/models/org_model.py \
             chayuan-server/libs/chayuan-server/chayuan/server/db/models/dept_model.py \
             chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py
# 按约定 bump 版本号后一并 add，再:
sudo git commit -m "feat(org): add Organization/Department ORM models"
```

---

## Task 2: Alembic 迁移（建表 + seed 默认组织）

**Files:**
- Create: `SRV/db/alembic/versions/0028_org_dept.py`

- [ ] **Step 1: 写迁移文件**

```python
"""组织 + 部门 表(P1 org-RBAC)。

新增 organizations(顶层平级组织) + departments(组织下部门树, ancestors 自包含逗号路径)。
seed 一个默认组织 'default'。两种建表模式(create_all/alembic)都安全:表已存在则跳过。

Revision ID: 0028_org_dept
Revises: 0027_conv_config_snapshot
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0028_org_dept"
down_revision = "0027_conv_config_snapshot"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _has_table("organizations"):
        op.create_table(
            "organizations",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("code", sa.String(length=32), nullable=False),
            sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code", name="uq_organizations_code"),
        )
        op.create_index("ix_organizations_code", "organizations", ["code"], unique=True)

    if not _has_table("departments"):
        op.create_table(
            "departments",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("org_id", sa.Integer(), nullable=False),
            sa.Column("parent_id", sa.Integer(), nullable=True),
            sa.Column("ancestors", sa.String(length=255), nullable=False, server_default=","),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("leader_user_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_departments_org_id", "departments", ["org_id"])
        op.create_index("ix_departments_parent_id", "departments", ["parent_id"])

    # seed 默认组织(幂等)
    bind = op.get_bind()
    existing = bind.execute(sa.text("SELECT id FROM organizations WHERE code = 'default'")).fetchall()
    if not existing:
        bind.execute(sa.text(
            "INSERT INTO organizations (name, code, order_num, status) "
            "VALUES ('默认组织', 'default', 0, 'active')"
        ))


def downgrade() -> None:
    if _has_table("departments"):
        op.drop_index("ix_departments_parent_id", table_name="departments")
        op.drop_index("ix_departments_org_id", table_name="departments")
        op.drop_table("departments")
    if _has_table("organizations"):
        op.drop_index("ix_organizations_code", table_name="organizations")
        op.drop_table("organizations")
```

- [ ] **Step 2: 验证迁移链头唯一**

Run:
```
cd /work/chayuan-desktop/chayuan-server && grep -rl "down_revision = \"0027_conv_config_snapshot\"" libs/chayuan-server/chayuan/server/db/alembic/versions/
```
Expected: 只列出 `0028_org_dept.py` 一个文件（确认没有两个版本同时指向 0027 造成分叉）。

- [ ] **Step 3: 在临时 sqlite 上验证 upgrade head 通过**

Run:
```
cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python - <<'PY'
import tempfile, os
db = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db}"
from alembic.config import Config
from alembic import command
cfg = Config("libs/chayuan-server/chayuan/server/db/alembic.ini")
cfg.set_main_option("script_location", "libs/chayuan-server/chayuan/server/db/alembic")
cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db}")
command.upgrade(cfg, "head")
import sqlalchemy as sa
e = sa.create_engine(f"sqlite:///{db}")
with e.connect() as c:
    print("orgs:", [r[0] for r in c.execute(sa.text("SELECT code FROM organizations")).fetchall()])
    print("dept_table_exists:", sa.inspect(e).has_table("departments"))
PY
```
Expected: `orgs: ['default']` 且 `dept_table_exists: True`。
（若 alembic.ini 路径或 env 读 URI 的方式与上面不符，改用项目既有的迁移触发方式 `python -m chayuan.server.db.migrator` 等价验证；关键是确认 upgrade 到 head 不报错且建出两表+seed。）

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/db/alembic/versions/0028_org_dept.py
sudo git commit -m "feat(org): alembic migration for organizations/departments + seed default org"
```

---

## Task 3: 组织仓库 org_repository（TDD）

**Files:**
- Test: `LIB/tests/unit_tests/test_org_dept_repository.py`
- Create: `SRV/db/repository/org_repository.py`

- [ ] **Step 1: 写失败测试（组织部分 + 公共 fixture）**

新建 `LIB/tests/unit_tests/test_org_dept_repository.py`：

```python
from __future__ import annotations
import pytest
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import org_repository as orgs
from chayuan.server.db.repository import dept_repository as depts


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(DepartmentModel).delete()
            s.query(OrganizationModel).delete()
    _purge(); yield; _purge()


def _new_org(code="t1"):
    return orgs.create_org("测试组织", code)


def test_create_and_list_org():
    o = _new_org()
    assert o["code"] == "t1"
    assert any(r["id"] == o["id"] for r in orgs.list_orgs())


def test_duplicate_org_code_rejected():
    _new_org("dup")
    with pytest.raises(ValueError):
        _new_org("dup")


def test_update_org():
    o = _new_org("up")
    got = orgs.update_org(o["id"], name="改名了")
    assert got["name"] == "改名了"


def test_delete_org_with_depts_blocked():
    o = _new_org("od")
    depts.create_dept(o["id"], None, "研发部")
    with pytest.raises(ValueError):
        orgs.delete_org(o["id"])
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py -k org`
Expected: FAIL / ERROR（`org_repository` 或 `dept_repository` ImportError，因为还没写）。

- [ ] **Step 3: 写 org_repository.py**

```python
"""组织仓库 —— 顶层组织 CRUD。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.session import session_scope


def list_orgs() -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.query(OrganizationModel).order_by(
            OrganizationModel.order_num, OrganizationModel.id
        ).all()
        return [r.to_dict() for r in rows]


def get_org(org_id: int) -> Optional[Dict[str, Any]]:
    with session_scope() as s:
        r = s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none()
        return r.to_dict() if r else None


def create_org(name: str, code: str, order_num: int = 0, remark: str = "") -> Dict[str, Any]:
    name = (name or "").strip()
    code = (code or "").strip()
    if not name:
        raise ValueError("组织名称不能为空")
    if not code:
        raise ValueError("组织编码不能为空")
    with session_scope() as s:
        if s.query(OrganizationModel).filter(OrganizationModel.code == code).one_or_none():
            raise ValueError(f"组织编码已存在：{code}")
        r = OrganizationModel(name=name, code=code, order_num=int(order_num or 0), remark=remark or "")
        s.add(r)
        s.flush()
        return r.to_dict()


def update_org(org_id: int, *, name=None, order_num=None, remark=None, status=None) -> Dict[str, Any]:
    with session_scope() as s:
        r = s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none()
        if not r:
            raise ValueError(f"组织不存在：{org_id}")
        if name is not None:
            r.name = name.strip()
        if order_num is not None:
            r.order_num = int(order_num)
        if remark is not None:
            r.remark = remark
        if status is not None:
            r.status = status
        return r.to_dict()


def delete_org(org_id: int) -> bool:
    with session_scope() as s:
        r = s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none()
        if not r:
            return False
        dept_count = s.query(DepartmentModel).filter(DepartmentModel.org_id == org_id).count()
        if dept_count:
            raise ValueError(f"组织下仍有 {dept_count} 个部门,请先删除部门")
        s.delete(r)
        return True
```

- [ ] **Step 4: 跑组织测试确认通过**

Run: `$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py -k org`
Expected: PASS（4 条组织相关；`test_delete_org_with_depts_blocked` 依赖 dept_repository，下个 Task 完成后再绿，本步先跑 `-k "org and not depts"` 也可）。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/db/repository/org_repository.py \
             chayuan-server/libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py
sudo git commit -m "feat(org): org_repository CRUD with delete guard"
```

---

## Task 4: 部门仓库 dept_repository（TDD）

**Files:**
- Modify: `LIB/tests/unit_tests/test_org_dept_repository.py`（追加部门用例）
- Create: `SRV/db/repository/dept_repository.py`

- [ ] **Step 1: 追加部门失败测试**

在 `test_org_dept_repository.py` 末尾追加：

```python
def test_dept_ancestors_self_wrapped():
    o = _new_org("anc")
    root = depts.create_dept(o["id"], None, "总部")
    child = depts.create_dept(o["id"], root["id"], "研发部")
    assert root["ancestors"] == f",{root['id']},"
    assert child["ancestors"] == f",{root['id']},{child['id']},"


def test_subtree_ids_includes_self_and_descendants():
    o = _new_org("st")
    root = depts.create_dept(o["id"], None, "总部")
    mid = depts.create_dept(o["id"], root["id"], "研发部")
    leaf = depts.create_dept(o["id"], mid["id"], "前端组")
    assert set(depts.subtree_ids(root["id"])) == {root["id"], mid["id"], leaf["id"]}
    assert set(depts.subtree_ids(mid["id"])) == {mid["id"], leaf["id"]}


def test_move_dept_recomputes_subtree():
    o = _new_org("mv")
    a = depts.create_dept(o["id"], None, "A")
    b = depts.create_dept(o["id"], None, "B")
    child = depts.create_dept(o["id"], a["id"], "A子")
    depts.move_dept(child["id"], b["id"])
    moved = depts.get_dept(child["id"])
    assert moved["parent_id"] == b["id"]
    assert moved["ancestors"] == f",{b['id']},{child['id']},"


def test_move_into_own_subtree_blocked():
    o = _new_org("cyc")
    a = depts.create_dept(o["id"], None, "A")
    child = depts.create_dept(o["id"], a["id"], "A子")
    with pytest.raises(ValueError):
        depts.move_dept(a["id"], child["id"])


def test_delete_dept_with_children_blocked():
    o = _new_org("dc")
    a = depts.create_dept(o["id"], None, "A")
    depts.create_dept(o["id"], a["id"], "A子")
    with pytest.raises(ValueError):
        depts.delete_dept(a["id"])


def test_dept_tree_nesting():
    o = _new_org("tree")
    root = depts.create_dept(o["id"], None, "总部")
    depts.create_dept(o["id"], root["id"], "研发部")
    tree = depts.dept_tree(o["id"])
    assert len(tree) == 1 and tree[0]["name"] == "总部"
    assert tree[0]["children"][0]["name"] == "研发部"


def test_create_dept_under_other_org_parent_rejected():
    o1 = _new_org("o1"); o2 = _new_org("o2")
    p = depts.create_dept(o1["id"], None, "P")
    with pytest.raises(ValueError):
        depts.create_dept(o2["id"], p["id"], "坏孩子")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py`
Expected: FAIL（ImportError: dept_repository 或函数缺失）。

- [ ] **Step 3: 写 dept_repository.py**

```python
"""部门仓库 —— 组织下部门树 CRUD + ancestors 维护 + 子树查询 + move。

ancestors 自包含逗号路径(含自身),根 ",<id>," 子 ",<parent...>,<id>,"。
子树 = `ancestors LIKE '%,<id>,%'`(逗号包裹防前缀误匹配)。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.session import session_scope


def _ancestors_for(parent: Optional[DepartmentModel], self_id: int) -> str:
    base = parent.ancestors if parent is not None else ","
    return f"{base}{self_id},"


def get_dept(dept_id: int) -> Optional[Dict[str, Any]]:
    with session_scope() as s:
        r = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        return r.to_dict() if r else None


def create_dept(org_id, parent_id, name, order_num=0, leader_user_id=None) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("部门名称不能为空")
    with session_scope() as s:
        if not s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none():
            raise ValueError(f"组织不存在：{org_id}")
        parent = None
        if parent_id is not None:
            parent = s.query(DepartmentModel).filter(DepartmentModel.id == parent_id).one_or_none()
            if not parent:
                raise ValueError(f"父部门不存在：{parent_id}")
            if int(parent.org_id) != int(org_id):
                raise ValueError("父部门与所选组织不一致")
        r = DepartmentModel(org_id=int(org_id), parent_id=parent_id, name=name,
                            order_num=int(order_num or 0), leader_user_id=leader_user_id,
                            ancestors=",")
        s.add(r)
        s.flush()  # 拿到 r.id
        r.ancestors = _ancestors_for(parent, r.id)
        return r.to_dict()


def update_dept(dept_id, *, name=None, order_num=None, leader_user_id=None, status=None) -> Dict[str, Any]:
    with session_scope() as s:
        r = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        if not r:
            raise ValueError(f"部门不存在：{dept_id}")
        if name is not None:
            r.name = name.strip()
        if order_num is not None:
            r.order_num = int(order_num)
        if leader_user_id is not None:
            r.leader_user_id = leader_user_id
        if status is not None:
            r.status = status
        return r.to_dict()


def move_dept(dept_id, new_parent_id) -> Dict[str, Any]:
    with session_scope() as s:
        d = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        if not d:
            raise ValueError(f"部门不存在：{dept_id}")
        new_parent = None
        new_org = d.org_id
        if new_parent_id is not None:
            new_parent = s.query(DepartmentModel).filter(DepartmentModel.id == new_parent_id).one_or_none()
            if not new_parent:
                raise ValueError(f"目标父部门不存在：{new_parent_id}")
            if f",{dept_id}," in (new_parent.ancestors or ","):
                raise ValueError("不能把部门移动到它自己的子部门下")
            new_org = new_parent.org_id
        old_prefix = d.ancestors                       # ",1,5,"
        new_prefix = _ancestors_for(new_parent, d.id)  # ",2,5,"
        subtree = s.query(DepartmentModel).filter(
            DepartmentModel.ancestors.like(old_prefix + "%")
        ).all()
        for node in subtree:
            node.ancestors = new_prefix + node.ancestors[len(old_prefix):]
            node.org_id = new_org
        d.parent_id = new_parent_id
        return d.to_dict()


def delete_dept(dept_id) -> bool:
    with session_scope() as s:
        r = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        if not r:
            return False
        child_count = s.query(DepartmentModel).filter(DepartmentModel.parent_id == dept_id).count()
        if child_count:
            raise ValueError(f"部门下仍有 {child_count} 个子部门,请先删除子部门")
        # 注: P2 给 users 加 dept_id 后,这里要再拦"部门下有用户"
        s.delete(r)
        return True


def subtree_ids(dept_id) -> List[int]:
    with session_scope() as s:
        rows = s.query(DepartmentModel.id).filter(
            DepartmentModel.ancestors.like(f"%,{dept_id},%")
        ).all()
        return [row[0] for row in rows]


def dept_tree(org_id) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.query(DepartmentModel).filter(
            DepartmentModel.org_id == org_id
        ).order_by(DepartmentModel.order_num, DepartmentModel.id).all()
        nodes = {r.id: {**r.to_dict(), "children": []} for r in rows}
        roots = []
        for r in rows:
            node = nodes[r.id]
            if r.parent_id and r.parent_id in nodes:
                nodes[r.parent_id]["children"].append(node)
            else:
                roots.append(node)
        return roots
```

- [ ] **Step 4: 跑全部仓库测试确认通过**

Run: `$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py`
Expected: PASS（全部用例，含 Task3 的 `test_delete_org_with_depts_blocked`）。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/db/repository/dept_repository.py \
             chayuan-server/libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py
sudo git commit -m "feat(org): dept_repository tree CRUD + ancestors/subtree/move"
```

---

## Task 5: 组织/部门 admin 路由（TDD）

**Files:**
- Test: `LIB/tests/unit_tests/test_org_dept_routes.py`
- Create: `SRV/api_server/orgs_routes.py`
- Modify: `SRV/api_server/server_app.py`（import + include_router）

- [ ] **Step 1: 写失败的路由测试**

新建 `LIB/tests/unit_tests/test_org_dept_routes.py`：

```python
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.orgs_routes import orgs_router, depts_router, _ADMIN


@pytest.fixture
def client():
    with session_scope() as s:
        s.query(DepartmentModel).delete()
        s.query(OrganizationModel).delete()
    app = FastAPI()
    app.include_router(orgs_router)
    app.include_router(depts_router)
    app.dependency_overrides[_ADMIN] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def test_org_crud_flow(client):
    r = client.post("/api/v1/admin/orgs", json={"name": "总公司", "code": "hq"})
    assert r.status_code == 200
    org_id = r.json()["data"]["id"]
    assert any(o["code"] == "hq" for o in client.get("/api/v1/admin/orgs").json()["data"]["orgs"])
    r = client.patch(f"/api/v1/admin/orgs/{org_id}", json={"name": "总公司改"})
    assert r.json()["data"]["name"] == "总公司改"
    assert client.delete(f"/api/v1/admin/orgs/{org_id}").status_code == 200


def test_create_org_duplicate_code_400(client):
    client.post("/api/v1/admin/orgs", json={"name": "A", "code": "dup"})
    assert client.post("/api/v1/admin/orgs", json={"name": "B", "code": "dup"}).status_code == 400


def test_dept_tree_via_routes(client):
    org_id = client.post("/api/v1/admin/orgs", json={"name": "X", "code": "x"}).json()["data"]["id"]
    root = client.post("/api/v1/admin/depts", json={"org_id": org_id, "name": "总部"}).json()["data"]
    client.post("/api/v1/admin/depts", json={"org_id": org_id, "parent_id": root["id"], "name": "研发部"})
    tree = client.get(f"/api/v1/admin/depts?org_id={org_id}").json()["data"]["tree"]
    assert tree[0]["children"][0]["name"] == "研发部"


def test_dept_move_via_routes(client):
    org_id = client.post("/api/v1/admin/orgs", json={"name": "X", "code": "mv"}).json()["data"]["id"]
    a = client.post("/api/v1/admin/depts", json={"org_id": org_id, "name": "A"}).json()["data"]
    b = client.post("/api/v1/admin/depts", json={"org_id": org_id, "name": "B"}).json()["data"]
    child = client.post("/api/v1/admin/depts", json={"org_id": org_id, "parent_id": a["id"], "name": "C"}).json()["data"]
    r = client.post(f"/api/v1/admin/depts/{child['id']}/move", json={"new_parent_id": b["id"]})
    assert r.status_code == 200
    assert r.json()["data"]["parent_id"] == b["id"]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_routes.py`
Expected: FAIL（ImportError: orgs_routes）。

- [ ] **Step 3: 写 orgs_routes.py**

```python
"""组织 + 部门 管理 admin REST(P1 org-RBAC)。

- /api/v1/admin/orgs           组织 CRUD
- /api/v1/admin/depts          部门树 CRUD + move
均 admin-only。返回 {"code":0,"msg":"ok","data":...} 信封。
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException

from chayuan.server.auth.deps import require_role

orgs_router = APIRouter(prefix="/api/v1/admin/orgs", tags=["admin-orgs"])
depts_router = APIRouter(prefix="/api/v1/admin/depts", tags=["admin-depts"])
_ADMIN = require_role("admin")


# ---- 组织 ----
@orgs_router.get("", summary="[admin] 列组织")
def list_orgs(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    return {"code": 0, "msg": "ok", "data": {"orgs": repo.list_orgs()}}


@orgs_router.post("", summary="[admin] 建组织")
def create_org(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    try:
        org = repo.create_org(
            str(body.get("name") or ""),
            str(body.get("code") or ""),
            int(body.get("order_num") or 0),
            str(body.get("remark") or ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": org}


@orgs_router.patch("/{org_id}", summary="[admin] 改组织")
def update_org(org_id: int, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    try:
        org = repo.update_org(
            org_id,
            name=body.get("name"),
            order_num=body.get("order_num"),
            remark=body.get("remark"),
            status=body.get("status"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": org}


@orgs_router.delete("/{org_id}", summary="[admin] 删组织")
def delete_org(org_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    try:
        ok = repo.delete_org(org_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail=f"组织不存在：{org_id}")
    return {"code": 0, "msg": "ok", "data": {"deleted": org_id}}


# ---- 部门 ----
@depts_router.get("", summary="[admin] 部门树")
def dept_tree(org_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    return {"code": 0, "msg": "ok", "data": {"tree": repo.dept_tree(org_id)}}


@depts_router.post("", summary="[admin] 建部门")
def create_dept(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        dept = repo.create_dept(
            int(body["org_id"]),
            body.get("parent_id"),
            str(body.get("name") or ""),
            int(body.get("order_num") or 0),
            body.get("leader_user_id"),
        )
    except KeyError:
        raise HTTPException(status_code=400, detail="缺少 org_id")
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e) or "参数错误")
    return {"code": 0, "msg": "ok", "data": dept}


@depts_router.patch("/{dept_id}", summary="[admin] 改部门")
def update_dept(dept_id: int, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        dept = repo.update_dept(
            dept_id,
            name=body.get("name"),
            order_num=body.get("order_num"),
            leader_user_id=body.get("leader_user_id"),
            status=body.get("status"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": dept}


@depts_router.post("/{dept_id}/move", summary="[admin] 移动部门")
def move_dept(dept_id: int, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        dept = repo.move_dept(dept_id, body.get("new_parent_id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": dept}


@depts_router.delete("/{dept_id}", summary="[admin] 删部门")
def delete_dept(dept_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        ok = repo.delete_dept(dept_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail=f"部门不存在：{dept_id}")
    return {"code": 0, "msg": "ok", "data": {"deleted": dept_id}}
```

- [ ] **Step 4: 跑路由测试确认通过**

Run: `$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_routes.py`
Expected: PASS（4 条）。

- [ ] **Step 5: 在 server_app.py 注册路由**

打开 `SRV/api_server/server_app.py`。在第 65 行 `from chayuan.server.api_server.roles_routes import roles_router` 之后追加一行：

```python
from chayuan.server.api_server.orgs_routes import orgs_router, depts_router
```

在第 189 行 `app.include_router(roles_router)` 之后追加两行（保持同样缩进）：

```python
    app.include_router(orgs_router)
    app.include_router(depts_router)
```

- [ ] **Step 6: 验证 app 能 import 且路由已挂载**

Run:
```
cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -c "from chayuan.server.api_server.server_app import create_app; app=create_app(); ps={r.path for r in app.routes}; print('/api/v1/admin/orgs' in ps, '/api/v1/admin/depts' in ps)"
```
Expected: `True True`
（若 `create_app` 名称/签名不同，改用 server_app 里实际的 app 工厂函数名；目的是确认两条路由前缀已注册、import 无环。）

- [ ] **Step 7: Commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/orgs_routes.py \
             chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py \
             chayuan-server/libs/chayuan-server/tests/unit_tests/test_org_dept_routes.py
sudo git commit -m "feat(org): admin REST for organizations/departments + register routers"
```

---

## Task 6: P1 收尾验证 + 推送

- [ ] **Step 1: 跑 P1 全量相关测试**

Run:
```
$PYTEST libs/chayuan-server/tests/unit_tests/test_org_dept_repository.py \
        libs/chayuan-server/tests/unit_tests/test_org_dept_routes.py
```
Expected: 全 PASS。

- [ ] **Step 2: 回归——确认没碰坏既有用户/角色测试**

Run:
```
$PYTEST libs/chayuan-server/tests/unit_tests/test_seat_create_user.py \
        libs/chayuan-server/tests/unit_tests/test_admin_users_routes.py
```
Expected: 全 PASS（P1 没改 users/roles，应零影响）。

- [ ] **Step 3: 单机版零影响自查**

确认本期所有改动都不在 guest/单机启动路径上：org/dept 表只被 admin 路由 + repository 触达，`require_role("admin")` 在单机 guest(role=user)下天然 403，不影响单机功能。无需改单机代码。在 commit 说明里记一句"单机零参与"。

- [ ] **Step 4: 按约定 bump 版本号并推送**

```bash
cd /work/chayuan-desktop
# 1) 按 feedback_version_bump_on_commit 规则把 VERSION / 3 个 tauri.conf / server pyproject +1
# 2) 已分任务提交的 commit 若想保留细分历史就直接 push；版本号单独一个 commit:
sudo git add VERSION   # 及其它被 bump 的文件
sudo git commit -m "chore(release): bump version for org/dept P1"
sudo git push origin main
```
Expected: push 成功到 origin/main。

---

## 自查（写完计划后的 fresh-eyes 核对）

**Spec 覆盖（对照 spec 第 3、5、7 节 P1 部分）：**
- organizations 表 → Task 1/2 ✓
- departments 表(ancestors 子树) → Task 1/2/4 ✓
- org/dept repository(树构建/ancestors/move 重算) → Task 3/4 ✓
- org/dept CRUD 路由 → Task 5 ✓
- seed 默认组织 → Task 2 ✓
- pytest schema/CRUD/子树/move 级联 → Task 3/4/5/6 ✓
- **明确推迟到后续期**（已在范围说明声明，非遗漏）：user_roles/dept_roles/role_scope_depts（P2/P3）、users.dept_id（P2）、roles.data_scope（P3）、kb grants 泛化（P4）、回填存量用户到默认组织（P2，随 users.dept_id 一起）、部门成员列表 + 部门角色映射端点（P2）。

**占位符扫描：** 无 TBD/TODO；每个改代码的步骤都给了完整代码或精确的插入行。`update_dept` 等"None 即不改"语义明确。

**类型/命名一致性：**
- repository 函数名在 repo / 路由 / 测试三处一致：`create_org/update_org/delete_org/list_orgs/get_org`、`create_dept/update_dept/move_dept/delete_dept/dept_tree/subtree_ids/get_dept`。
- 路由信封统一 `{"code":0,"msg":"ok","data":...}`，与既有 roles_routes 一致。
- `_ADMIN = require_role("admin")` 模块级单例，测试用 `dependency_overrides[_ADMIN]` 覆盖（与 test_admin_users_routes 同款）。
- ancestors 语义（自包含、逗号包裹）在 model docstring、repository、测试断言三处一致。

**已知软依赖（执行时留意）：**
- 测试建表依赖 conftest 的 create_all 会在 metadata 含新表后自动建（Task1 Step4 已冒烟）；若测试报 "no such table: organizations"，先确认 Task1 Step3 的 __init__ 导入已生效。
- Task2 Step3 的 alembic 触发脚本若与项目实际 env 读 URI 方式不符，用项目既有迁移入口等价验证（关键是 upgrade head 不报错 + 建出两表 + seed default）。

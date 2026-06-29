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

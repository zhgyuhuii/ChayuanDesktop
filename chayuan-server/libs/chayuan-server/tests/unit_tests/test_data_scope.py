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

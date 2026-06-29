"""org-RBAC 端到端 capstone：组织→部门树→部门继承角色→用户(部门+直接角色)
→ effective_roles → 按部门授 KB(含子树) → kb_access_for 验权 → 列表可见。

贯穿 P1-P4 的集成：验证各期能组合工作。
"""
from __future__ import annotations

import pytest

from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.dept_role_model import DeptRoleModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.role_model import RoleModel
from chayuan.server.db.models.role_scope_dept_model import RoleScopeDeptModel
from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import org_repository as orgs
from chayuan.server.db.repository import dept_repository as depts
from chayuan.server.db.repository import role_repository as rr
from chayuan.server.db.repository import user_role_repository as urr
from chayuan.server.db.repository import kb_grant_repository as kg
from chayuan.server.auth.access import kb_access_for, list_accessible_kbs


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            for M in (KbSubjectGrantModel, RoleScopeDeptModel, DeptRoleModel,
                      UserRoleModel, UserModel, KnowledgeBaseModel,
                      DepartmentModel, OrganizationModel):
                s.query(M).delete()
            s.query(RoleModel).filter(RoleModel.is_system == False).delete()  # noqa: E712
    _purge(); rr.ensure_builtin_roles(); yield; _purge()


def _mk_user(username, dept_id, direct_roles):
    with session_scope() as s:
        u = UserModel(username=username, password_hash="x", role=direct_roles[0],
                      is_active=True, dept_id=dept_id)
        s.add(u); s.flush(); s.refresh(u); s.expunge(u); uid = u.id
    urr.set_user_roles(uid, list(direct_roles))
    return uid


def _mk_kb(name, owner_id=99999, vis="private"):
    with session_scope() as s:
        kb = KnowledgeBaseModel(kb_name=name, owner_id=owner_id, visibility=vis)
        s.add(kb); s.flush(); kid = kb.id; s.expunge(kb)
        return kid


def test_full_org_rbac_chain():
    # 1) 组织 + 部门树:总公司 / 研发部 / 前端组
    org = orgs.create_org("总公司", "hq")
    rnd = depts.create_dept(org["id"], None, "研发部")
    fe = depts.create_dept(org["id"], rnd["id"], "前端组")

    # 2) 自定义角色
    rr.create_role("viewer", "查看者", ["app.kb"], data_scope=4)
    rr.create_role("sales", "销售", ["app.chat"], data_scope=3)

    # 3) 研发部挂继承角色 viewer(含子树)
    depts.set_dept_roles(rnd["id"], [{"role_name": "viewer", "include_subtree": True}])

    # 4) 前端组的用户,直接角色 sales
    uid = _mk_user("zhang", fe["id"], ["sales"])
    user = {"id": uid, "username": "zhang", "role": "sales"}

    # 5) 有效角色 = 直接 sales ∪ 继承 viewer(来自上级研发部 include_subtree)
    eff = set(urr.effective_roles(uid, fe["id"]))
    assert {"sales", "viewer"} <= eff

    # 5b) 模块并集含两个角色的功能权
    mods = set(rr.effective_modules_multi(list(eff)))
    assert {"app.kb", "app.chat"} <= mods

    # 6) 建 KB,按部门"研发部"授权(含子树)editor
    kid = _mk_kb("产品手册")
    kg.add_grant(kid, "dept", str(rnd["id"]), "editor", include_subtree=True)

    # 7) 前端组用户(研发部的子部门)应得 editor
    assert kb_access_for(user, "产品手册") == "editor"

    # 8) 列表里能看到该 KB
    assert "产品手册" in list_accessible_kbs(user)


def test_no_subtree_blocks_descendant():
    # 部门授权未开子树 → 子部门用户访问不到
    org = orgs.create_org("公司", "co")
    parent = depts.create_dept(org["id"], None, "总部")
    child = depts.create_dept(org["id"], parent["id"], "小组")
    uid = _mk_user("li", child["id"], ["user"])
    user = {"id": uid, "username": "li", "role": "user"}
    kid = _mk_kb("机密库")
    kg.add_grant(kid, "dept", str(parent["id"]), "reader", include_subtree=False)
    assert kb_access_for(user, "机密库") is None
    assert "机密库" not in list_accessible_kbs(user)

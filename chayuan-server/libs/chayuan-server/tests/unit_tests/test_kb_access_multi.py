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
from chayuan.server.auth.access import kb_access_for, list_accessible_kbs


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            for M in (KbSubjectGrantModel, UserRoleModel, UserModel,
                      KnowledgeBaseModel, DepartmentModel, OrganizationModel):
                s.query(M).delete()
    _purge(); yield; _purge()


def _kb(name="kb1", owner_id=99999, vis="private"):
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


def test_role_grant_shows_in_listing():
    kid, name = _kb()  # private, owner_id=99999
    uid = _user(roles=("user", "sales"))
    kg.add_grant(kid, "role", "sales", "reader")
    assert name in list_accessible_kbs(_U(uid))


def test_no_grant_not_in_listing():
    kid, name = _kb()  # private
    uid = _user()
    assert name not in list_accessible_kbs(_U(uid))

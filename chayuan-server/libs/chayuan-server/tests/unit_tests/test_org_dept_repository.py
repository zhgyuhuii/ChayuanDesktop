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


def test_move_deep_subtree_rewrites_all_descendants():
    o = _new_org("deep")
    a = depts.create_dept(o["id"], None, "A")
    b = depts.create_dept(o["id"], None, "B")
    mid = depts.create_dept(o["id"], a["id"], "mid")
    leaf = depts.create_dept(o["id"], mid["id"], "leaf")
    depts.move_dept(mid["id"], b["id"])  # move a non-leaf subtree
    mid2 = depts.get_dept(mid["id"]); leaf2 = depts.get_dept(leaf["id"])
    assert mid2["parent_id"] == b["id"]
    assert mid2["ancestors"] == f",{b['id']},{mid['id']},"
    assert leaf2["ancestors"] == f",{b['id']},{mid['id']},{leaf['id']},"
    assert set(depts.subtree_ids(b["id"])) == {b["id"], mid["id"], leaf["id"]}


def test_move_to_root():
    o = _new_org("toroot")
    a = depts.create_dept(o["id"], None, "A")
    child = depts.create_dept(o["id"], a["id"], "child")
    gc = depts.create_dept(o["id"], child["id"], "gc")
    depts.move_dept(child["id"], None)  # re-root
    child2 = depts.get_dept(child["id"]); gc2 = depts.get_dept(gc["id"])
    assert child2["parent_id"] is None
    assert child2["ancestors"] == f",{child['id']},"
    assert gc2["ancestors"] == f",{child['id']},{gc['id']},"


def test_cross_org_move_propagates_org_id():
    o1 = _new_org("cx1"); o2 = _new_org("cx2")
    a = depts.create_dept(o1["id"], None, "A")
    child = depts.create_dept(o1["id"], a["id"], "child")
    target = depts.create_dept(o2["id"], None, "target")
    depts.move_dept(a["id"], target["id"])
    a2 = depts.get_dept(a["id"]); child2 = depts.get_dept(child["id"])
    assert a2["org_id"] == o2["id"] and child2["org_id"] == o2["id"]
    assert a2["ancestors"] == f",{target['id']},{a['id']},"
    assert child2["ancestors"] == f",{target['id']},{a['id']},{child['id']},"


def test_delete_dept_with_users_blocked():
    """借鉴 RuoYi:部门下有用户不允许删除。"""
    from chayuan.server.db.models.user_model import UserModel
    o = _new_org("du")
    d = depts.create_dept(o["id"], None, "有人部门")
    with session_scope() as s:
        u = UserModel(username="dept_member_x", password_hash="x", role="user",
                      is_active=True, dept_id=d["id"])
        s.add(u); s.flush(); uid = u.id
    try:
        with pytest.raises(ValueError):
            depts.delete_dept(d["id"])
        # 用户改派走后,可正常删
        with session_scope() as s:
            row = s.query(UserModel).filter(UserModel.id == uid).first()
            row.dept_id = None
        assert depts.delete_dept(d["id"]) is True
    finally:
        with session_scope() as s:
            s.query(UserModel).filter(UserModel.id == uid).delete()

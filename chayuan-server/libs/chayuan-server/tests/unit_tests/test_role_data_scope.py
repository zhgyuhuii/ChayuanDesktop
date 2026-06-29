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

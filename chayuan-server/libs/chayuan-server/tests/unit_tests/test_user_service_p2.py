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

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

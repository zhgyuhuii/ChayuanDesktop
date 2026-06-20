from __future__ import annotations
import pytest
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope
from chayuan.server.license import seat


@pytest.fixture(autouse=True)
def _clean_users():
    def _purge():
        with session_scope() as s:
            s.query(UserModel).delete()
    _purge(); yield; _purge()


@pytest.fixture(autouse=True)
def _net_root(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.delenv("CHAYUAN_SEAT_DISABLED", raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    yield


def test_under_cap_allows(tmp_path):
    seat.write_deployment_license(tmp_path, {"maxUsers": 3, "expireAt": 9999999999, "fp": "x"})
    svc.create_user("u1", "secret123", role="admin")
    svc.create_user("u2", "secret123", role="user")
    assert svc.create_user("u3", "secret123", role="user") is not None


def test_at_cap_raises(tmp_path):
    seat.write_deployment_license(tmp_path, {"maxUsers": 2, "expireAt": 9999999999, "fp": "x"})
    svc.create_user("u1", "secret123", role="admin")
    svc.create_user("u2", "secret123", role="user")
    with pytest.raises(seat.SeatLimitReached):
        svc.create_user("u3", "secret123", role="user")


def test_single_machine_unlimited(monkeypatch):
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    for i in range(15):
        svc.create_user(f"d{i}", "secret123", role="user")
    with session_scope() as s:
        assert s.query(UserModel).count() == 15

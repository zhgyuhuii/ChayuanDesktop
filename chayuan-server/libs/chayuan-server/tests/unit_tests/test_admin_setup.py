"""首启管理员设置(机制1 + /auth/setup)单测。

覆盖:admin_exists / bootstrap 机制1 / /auth/config 字段(含 instance_name) /
POST /auth/setup 建管理员 + 409 + config 翻转。

注:DB-backed,需真机依赖(fastapi/sqlalchemy);沙箱无依赖跑不了,只做语法校验。
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope


@pytest.fixture(autouse=True)
def _clean_users():
    """每例前后清空 users 表,避免 DB-backed 测试互相污染。"""
    def _purge():
        with session_scope() as s:
            s.query(UserModel).delete()
    _purge()
    yield
    _purge()


# ── admin_exists ────────────────────────────────────────────────
def test_admin_exists_false_when_empty():
    assert svc.admin_exists() is False


def test_admin_exists_true_after_admin_created():
    svc.create_user("alice", "secret123", role="admin")
    assert svc.admin_exists() is True


def test_admin_exists_false_when_only_normal_user():
    svc.create_user("bob", "secret123", role="user")
    assert svc.admin_exists() is False


# ── bootstrap 机制1 ─────────────────────────────────────────────
def test_bootstrap_skips_when_no_password():
    fake = MagicMock()
    fake.basic_settings.AUTH_DEFAULT_ADMIN_USERNAME = "admin"
    fake.basic_settings.AUTH_DEFAULT_ADMIN_PASSWORD = ""
    with patch("chayuan.settings.Settings", fake):
        assert svc.bootstrap_default_admin() is None
    assert svc.admin_exists() is False


def test_bootstrap_creates_when_password_set():
    fake = MagicMock()
    fake.basic_settings.AUTH_DEFAULT_ADMIN_USERNAME = "root"
    fake.basic_settings.AUTH_DEFAULT_ADMIN_PASSWORD = "explicit123"
    with patch("chayuan.settings.Settings", fake):
        out = svc.bootstrap_default_admin()
    assert out == ("root", "explicit123")
    assert svc.admin_exists() is True


# ── /auth/config + /auth/setup ──────────────────────────────────
def _client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from chayuan.server.api_server.auth_routes import auth_router
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


def test_config_reports_setup_required_when_no_admin():
    c = _client()
    r = c.get("/auth/config")
    assert r.status_code == 200
    assert r.json()["admin_setup_required"] is True


def test_setup_creates_admin_and_logs_in_then_409():
    c = _client()
    r = c.post(
        "/auth/setup",
        json={"username": "owner", "password": "secret123", "instance_name": "实例A"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["user"]["role"] == "admin"
    assert svc.admin_exists() is True

    # 实例标识应被存储,且经 /auth/config 读回(存+读路径)
    cfg = c.get("/auth/config").json()
    assert cfg["instance_name"] == "实例A"

    # 二次设置应被拒
    r2 = c.post("/auth/setup", json={"username": "x", "password": "secret123"})
    assert r2.status_code == 409

    # config 现在应报 false
    assert cfg["admin_setup_required"] is False

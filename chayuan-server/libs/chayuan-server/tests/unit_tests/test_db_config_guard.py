"""C2: 业务库配置可信化守卫测试。

覆盖三件事:
1. 保存前强制校验:validate 失败时不落盘、返回非零 code。
2. db_base 网络模式下驱动缺失不静默回退 sqlite,而是抛错。
3. 保存成功时按是否单机版返回 profile_warning。
"""
from __future__ import annotations

import pytest

from chayuan.server.api_server import db_config_routes


def _minimal_pg_body() -> dict:
    return {
        "db_type": "postgresql",
        "host": "db.example.com",
        "port": "5432",
        "database": "chayuan",
        "username": "u",
        "password": "p",
    }


def test_save_rejects_when_validation_fails(monkeypatch):
    """validate 失败 -> 不调用 save_updates,且 code 非 0。"""
    calls = {"saved": False}

    monkeypatch.setattr(
        db_config_routes,
        "_validate_uri",
        lambda uri, timeout=5: {
            "ok": False,
            "message": "auth failed",
            "detail": "password authentication failed",
            "db_missing": False,
        },
    )
    monkeypatch.setattr(
        db_config_routes.yaml_store,
        "save_updates",
        lambda *a, **k: calls.__setitem__("saved", True),
    )

    resp = db_config_routes._save_db_config(_minimal_pg_body())

    assert calls["saved"] is False
    assert resp["code"] != 0


def test_save_persists_when_validation_ok(monkeypatch):
    """validate ok -> 落盘,code 0。"""
    calls = {"saved": False, "updates": None}

    monkeypatch.setattr(
        db_config_routes,
        "_validate_uri",
        lambda uri, timeout=5: {"ok": True, "message": "", "detail": "", "db_missing": False},
    )

    def _fake_save(name, updates):
        calls["saved"] = True
        calls["updates"] = updates

    monkeypatch.setattr(db_config_routes.yaml_store, "save_updates", _fake_save)
    monkeypatch.setattr(db_config_routes, "_is_single_machine", lambda: False)

    resp = db_config_routes._save_db_config(_minimal_pg_body())

    assert calls["saved"] is True
    assert resp["code"] == 0
    assert "SQLALCHEMY_DATABASE_URI" in calls["updates"]


def test_save_persists_when_db_missing(monkeypatch):
    """db_missing(库不存在但能连/认证通过)仍可保存,保存后再自动创建。"""
    calls = {"saved": False}

    monkeypatch.setattr(
        db_config_routes,
        "_validate_uri",
        lambda uri, timeout=5: {
            "ok": False,
            "message": "db missing",
            "detail": "database does not exist",
            "db_missing": True,
        },
    )
    monkeypatch.setattr(
        db_config_routes.yaml_store,
        "save_updates",
        lambda *a, **k: calls.__setitem__("saved", True),
    )
    monkeypatch.setattr(db_config_routes, "_is_single_machine", lambda: False)

    resp = db_config_routes._save_db_config(_minimal_pg_body())

    assert calls["saved"] is True
    assert resp["code"] == 0


def test_save_sets_profile_warning_when_single_machine(monkeypatch):
    """单机版 -> profile_warning True;网络版 -> False。"""
    monkeypatch.setattr(
        db_config_routes,
        "_validate_uri",
        lambda uri, timeout=5: {"ok": True, "message": "", "detail": "", "db_missing": False},
    )
    monkeypatch.setattr(db_config_routes.yaml_store, "save_updates", lambda *a, **k: None)

    monkeypatch.setattr(db_config_routes, "_is_single_machine", lambda: True)
    resp = db_config_routes._save_db_config(_minimal_pg_body())
    assert resp["data"]["profile_warning"] is True

    monkeypatch.setattr(db_config_routes, "_is_single_machine", lambda: False)
    resp = db_config_routes._save_db_config(_minimal_pg_body())
    assert resp["data"]["profile_warning"] is False


def test_base_network_mode_no_silent_sqlite_fallback(monkeypatch):
    """网络模式驱动缺失 -> 抛错(不静默回退 sqlite)。单机模式 -> 回退。"""
    pytest.importorskip("sqlalchemy")  # base.py 顶层 import sqlalchemy
    from chayuan.server.db import base as db_base

    class _FakeBS:
        SQLALCHEMY_DATABASE_URI = "postgresql://u:secret@db.example.com:5432/chayuan"

    monkeypatch.setattr(db_base.Settings, "basic_settings", _FakeBS(), raising=False)

    def _boom(uri, bs):
        raise ModuleNotFoundError("No module named 'psycopg2'")

    monkeypatch.setattr(db_base, "_create_pooled_engine", _boom)

    sqlite_built = {"hit": False}

    def _fake_sqlite(uri, bs):
        sqlite_built["hit"] = True
        return object()

    monkeypatch.setattr(db_base, "_create_sqlite_engine", _fake_sqlite)

    # 网络模式 -> 抛错,且不构建 sqlite
    import chayuan.server.profiles.bootstrap as bootstrap
    monkeypatch.setattr(bootstrap, "is_single_machine", lambda: False)
    with pytest.raises(RuntimeError) as exc:
        db_base._build_engine()
    assert "psycopg2" in str(exc.value)
    # 凭证不应明文出现在异常信息里
    assert "secret" not in str(exc.value)
    assert sqlite_built["hit"] is False

    # 单机模式 -> 回退 sqlite,不抛
    monkeypatch.setattr(bootstrap, "is_single_machine", lambda: True)
    sqlite_built["hit"] = False
    db_base._build_engine()
    assert sqlite_built["hit"] is True

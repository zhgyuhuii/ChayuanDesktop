"""require_admin_when_auth_enabled:单机放行机主、网络要求 admin。

只依赖 chayuan.server.auth.deps + chayuan.settings(不引 openai/langchain),
本机 py311(root)可真跑。
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def _req(user=None):
    return SimpleNamespace(state=SimpleNamespace(user=user))


def _set_auth_required(monkeypatch, val):
    # dep 内部 `from chayuan.settings import Settings` → 替换模块级 Settings 即可
    import chayuan.settings as cs
    monkeypatch.setattr(
        cs, "Settings", SimpleNamespace(basic_settings=SimpleNamespace(AUTH_REQUIRED=val))
    )


def test_single_machine_allows_owner(monkeypatch):
    from chayuan.server.auth.deps import require_admin_when_auth_enabled
    _set_auth_required(monkeypatch, False)
    dep = require_admin_when_auth_enabled()
    assert dep(_req(None)) is None  # 单机:游客/机主放行


def test_network_blocks_non_admin(monkeypatch):
    from chayuan.server.auth.deps import require_admin_when_auth_enabled
    _set_auth_required(monkeypatch, True)
    dep = require_admin_when_auth_enabled()
    with pytest.raises(HTTPException) as ei:
        dep(_req({"id": 5, "username": "u", "role": "user"}))
    assert ei.value.status_code == 403


def test_network_allows_admin(monkeypatch):
    from chayuan.server.auth.deps import require_admin_when_auth_enabled
    _set_auth_required(monkeypatch, True)
    dep = require_admin_when_auth_enabled()
    u = {"id": 1, "username": "a", "role": "admin"}
    assert dep(_req(u)) == u


def test_network_no_user_401(monkeypatch):
    from chayuan.server.auth.deps import require_admin_when_auth_enabled
    _set_auth_required(monkeypatch, True)
    dep = require_admin_when_auth_enabled()
    with pytest.raises(HTTPException) as ei:
        dep(_req(None))
    assert ei.value.status_code == 401

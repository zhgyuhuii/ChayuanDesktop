from __future__ import annotations
import pytest


def test_apps_store_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from chayuan.server.config_panel import apps_store as st
    spec = st.create_app("测试应用", callback_url="https://x/cb", scopes=["chat:read"])
    assert spec.app_id and spec.app_secret
    got = st.get_app(spec.app_id)
    assert got is not None and got.name == "测试应用"
    # 脱敏:列表不含明文 secret
    masked = got.to_dict(include_secret=False)
    assert masked["app_secret"] != spec.app_secret
    # 轮换:secret 变化
    rot = st.rotate_secret(spec.app_id)
    assert rot is not None and rot.app_secret != spec.app_secret
    assert st.update_app(spec.app_id, enabled=False) is not None
    assert st.delete_app(spec.app_id) is True


def test_apps_router_importable():
    from chayuan.server.api_server.apps_routes import apps_router
    assert apps_router.prefix == "/api/v1/admin/apps"

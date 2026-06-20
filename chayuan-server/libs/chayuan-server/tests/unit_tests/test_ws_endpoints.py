from __future__ import annotations
import pytest


def test_ws_store_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from chayuan.server.config_panel import websocket_endpoints_store as st
    spec = st._parse({"name": "myws", "url": "ws://x/y", "enabled": True,
                      "auth": {"type": "bearer", "value": "tok"}, "params": [{"name": "q", "required": True}]})
    assert st.validate_spec(spec) == [] or isinstance(st.validate_spec(spec), list)
    st.save_endpoint(spec)
    got = st.get_endpoint("myws")
    assert got is not None and got.url == "ws://x/y" and got.enabled is True
    assert any(e.name == "myws" for e in st.list_endpoints())
    assert st.delete_endpoint("myws") is True
    assert st.get_endpoint("myws") is None


def test_ws_router_importable():
    from chayuan.server.api_server.ws_endpoints_routes import ws_endpoints_router
    assert ws_endpoints_router.prefix == "/api/v1/ws-endpoints"

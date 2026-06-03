from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server import license_routes


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    app = FastAPI()
    app.include_router(license_routes.license_router)
    return TestClient(app)


def test_activate_maps_ok_true_to_licensed(tmp_path, monkeypatch):
    monkeypatch.setattr(
        license_routes.engine, "redeem_shortcode",
        lambda *a, **k: {"ok": True, "kind": "count", "modules": ["avatar"], "added": 1},
    )
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate", json={"serial": "X"}).json()
    assert r["licensed"] is True


def test_activate_maps_failure_to_licensed_false_with_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(
        license_routes.engine, "redeem_shortcode",
        lambda *a, **k: {"ok": False, "reason": "no-module"},
    )
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate", json={"serial": "X"}).json()
    assert r["licensed"] is False
    assert r["reason"] == "no-module"


def test_activate_token_maps_ok_to_licensed(tmp_path, monkeypatch):
    monkeypatch.setattr(
        license_routes.engine, "redeem",
        lambda *a, **k: {"ok": True, "applied": []},
    )
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate-token", json={"token": "X"}).json()
    assert r["licensed"] is True

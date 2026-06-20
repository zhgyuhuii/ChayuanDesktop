from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.delenv("CHAYUAN_SEAT_DISABLED", raising=False)
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)


def test_status_network_default(client):
    r = client.get("/api/v1/license/deployment/status")
    assert r.status_code == 200
    b = r.json()
    assert b["maxUsers"] == 10 and b["edition"] == "web" and "fingerprint" in b


def test_status_single_machine_unlimited(client, monkeypatch):
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    b = client.get("/api/v1/license/deployment/status").json()
    assert b["maxUsers"] is None and b["edition"] == "desktop"


def test_activate_bad_token(client):
    r = client.post("/api/v1/license/deployment/activate", json={"token": "garbage"})
    assert r.status_code == 200 and r.json()["ok"] is False

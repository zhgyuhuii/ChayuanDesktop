import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    from chayuan.server.auth import deps
    monkeypatch.setattr(deps, "require_auth_enabled", lambda: (lambda: {"id": "u"}))
    from chayuan.server.api_server.file_routes import file_router
    app = FastAPI()
    app.include_router(file_router)
    return TestClient(app, raise_server_exceptions=False)


def test_unknown_kind_400(client):
    r = client.get("/v1/files", params={"kind": "nope"})
    assert r.status_code == 400


def test_artifact_404_when_missing(client, monkeypatch):
    from chayuan.server.file_service.adapters import artifact as mod
    monkeypatch.setattr(mod, "find_by_filename", lambda n: None)
    monkeypatch.setattr(mod, "fetch_from_storage", lambda n: None)
    r = client.get("/v1/files", params={"kind": "artifact", "name": "x.png"})
    assert r.status_code == 404

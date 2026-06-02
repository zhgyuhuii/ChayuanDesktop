from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.setenv("LICENSE_BUY_BASE_URL", "https://example.test")
    monkeypatch.setenv("LICENSE_PRODUCTS", '{"video": 0}')
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)


def test_share_url_builds_local_ref(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    fp = c.get("/api/v1/license/fingerprint").json()["fingerprint"]
    r = c.get("/api/v1/license/share-url?app=video").json()
    assert r["fingerprint"] == fp
    assert r["url"] == f"https://example.test/buy?app=video&ref={fp}"


def test_share_url_invalid_app(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.get("/api/v1/license/share-url?app=bogus").json()
    assert r == {"url": "", "fingerprint": ""}

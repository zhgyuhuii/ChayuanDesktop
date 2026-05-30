from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.digital_human_routes import digital_human_router
from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation.digital_human import jobs as dh_jobs


def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    # AUTH_REQUIRED=true in the running environment — patch it off so the bare
    # TestClient (no JWT middleware) can exercise the routes without 401.
    from chayuan.settings import Settings
    monkeypatch.setattr(Settings.basic_settings, "AUTH_REQUIRED", False)
    app = FastAPI(); app.include_router(digital_human_router)
    return TestClient(app)


def test_preset_crud_endpoints(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/presets", json={
        "name": "主播A", "avatar_ref": "bundled:f1", "avatar_kind": "video",
        "voice_provider": "clone", "voice_name": "clone:x"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert c.get("/api/v1/digital-human/presets").json()["items"][0]["name"] == "主播A"
    assert c.delete(f"/api/v1/digital-human/presets/{pid}").json()["deleted"] is True


def test_generate_enqueues(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: "tid123")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "你好", "width": 720, "height": 1280})
    assert r.status_code == 200 and r.json()["task_id"] == "tid123"


def test_upload_product(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/products",
               files={"file": ("p.png", b"x", "image/png")})
    assert r.status_code == 200 and r.json()["ref"].startswith("product:")


def test_generate_passes_product(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tid9")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "product_image": "product:p.png", "template": "corner"})
    assert r.status_code == 200 and r.json()["task_id"] == "tid9"
    assert seen.get("product_ref") == "product:p.png" and seen.get("template") == "corner"

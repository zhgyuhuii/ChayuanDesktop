from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.digital_human_routes import digital_human_router
from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation.digital_human import engine as dh_engine


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


def test_generate_passes_matte(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tidM")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "product_image": "product:p.png",
                     "template": "bg", "matte": True})
    assert r.status_code == 200 and seen.get("matte") is True


def test_list_engines(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.get("/api/v1/digital-human/engines")
    assert r.status_code == 200
    items = r.json()["items"]
    ids = {e["id"] for e in items}
    assert ids == {"wav2lip", "sadtalker", "musetalk"}
    assert next(e for e in items if e["id"] == "wav2lip")["installed"] is True


def test_generate_passes_engine(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tidE")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "engine": "musetalk"})
    assert r.status_code == 200 and seen.get("engine") == "musetalk"


def test_live_offer_relays(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    monkeypatch.setattr(routes, "_realtime_port_listening", lambda: True)

    class _Resp:
        status_code = 200

        def json(self):
            return {"sdp": "ANSWER", "type": "answer"}

        def raise_for_status(self):
            pass

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json, timeout=None):
            assert url.endswith(":18880/offer")
            return _Resp()

    monkeypatch.setattr("httpx.Client", _Client)
    r = c.post("/api/v1/digital-human/live/offer", json={"sdp": "OFFER", "type": "offer"})
    assert r.status_code == 200 and r.json()["sdp"] == "ANSWER"


def test_live_available(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    monkeypatch.setattr(routes, "_realtime_port_listening", lambda: True)
    r = c.get("/api/v1/digital-human/live/available")
    assert r.json()["available"] is True


def test_create_preset_route_accepts_avatars(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/presets", json={
        "name": "X", "avatar_ref": "user:a.png", "avatar_kind": "image",
        "avatars": [{"ref": "user:a.png", "kind": "image"}],
        "compose_mode": "coframe", "layout": "pip"})
    assert r.status_code == 200
    data = r.json()
    assert data["compose_mode"] == "coframe" and len(data["avatars"]) == 1

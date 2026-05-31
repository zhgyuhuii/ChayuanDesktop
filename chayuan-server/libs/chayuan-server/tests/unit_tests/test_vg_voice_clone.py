from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.video_generation_routes import video_generation_router
from chayuan.server.video_generation import _helpers


def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    from chayuan.settings import Settings
    monkeypatch.setattr(Settings.basic_settings, "AUTH_REQUIRED", False)
    app = FastAPI(); app.include_router(video_generation_router)
    return TestClient(app)


def test_rename_clone_voice(monkeypatch, tmp_path):
    import json, os
    from chayuan.server.video_generation import _helpers
    d = str(tmp_path / "voice_clones"); os.makedirs(d, exist_ok=True)
    monkeypatch.setattr(_helpers, "voice_clones_dir", lambda *, create=False: d)
    open(os.path.join(d, "abc.wav"), "wb").close()
    json.dump({"name": "旧名", "created": 1.0}, open(os.path.join(d, "abc.json"), "w"))
    c = _client(monkeypatch, tmp_path)
    r = c.patch("/api/v1/video-generation/voices/clone/abc", json={"name": "新名"})
    assert r.status_code == 200 and r.json()["label"] == "新名"
    assert json.load(open(os.path.join(d, "abc.json")))["name"] == "新名"

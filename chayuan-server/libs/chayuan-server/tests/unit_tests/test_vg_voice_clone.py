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


def test_quality_warnings_short_and_long():
    from chayuan.server.api_server.video_generation_routes import _quality_warnings
    assert any("过短" in w for w in _quality_warnings(1.0))
    assert any("过长" in w for w in _quality_warnings(45.0))
    assert _quality_warnings(5.0) == []


def test_probe_wav_duration(tmp_path):
    import wave, os
    from chayuan.server.api_server.video_generation_routes import _probe_wav_duration
    p = os.path.join(str(tmp_path), "t.wav")
    w = wave.open(p, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    w.writeframes(b"\x00\x00" * 24000 * 3); w.close()
    assert abs(_probe_wav_duration(p) - 3.0) < 0.1

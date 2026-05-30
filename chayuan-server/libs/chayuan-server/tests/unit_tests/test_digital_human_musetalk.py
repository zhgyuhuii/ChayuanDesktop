"""Unit tests for MuseTalk GPU runtime framework registration (GPU-P3 T1)."""


def test_musetalk_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "musetalk"), None)
    assert spec is not None and spec.needs_gpu is True and "18780" in spec.default_url


def test_musetalk_launch_recipe_present():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("musetalk")
    assert rec is not None and "musetalk_server" in rec.label


def test_musetalk_install_recipe_present():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("musetalk")
    joined = " ".join(" ".join(r.cmd) for r in out)
    assert "MuseTalk" in joined or "musetalk" in joined


def test_musetalk_server_imports_clean():
    import importlib
    m = importlib.import_module("chayuan.server.modality.musetalk_server")
    assert hasattr(m, "main") and hasattr(m, "_register_routes")


import os

def test_musetalk_engine_forwards(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    posted = {}
    class _Resp:
        status_code = 200
        def json(self): return {"ok": True}
        def raise_for_status(self): pass
    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, json, timeout=None):
            posted.update(url=url, body=json); return _Resp()
    monkeypatch.setattr("httpx.Client", _Client)
    monkeypatch.setattr(dh_engine, "_musetalk_ensure_ready", lambda: None)
    out = os.path.join(tmp_path, "o.mp4"); open(out, "wb").write(b"x")
    e = dh_engine.MuseTalkEngine()
    r = e.generate(avatar_path="v.mp4", audio_path="a.wav", out_path=out, width=720, height=1280)
    assert r == out and posted["url"].endswith("/infer") and ":18780/" in posted["url"]

def test_get_engine_musetalk_is_real_engine():
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    assert isinstance(dh_engine.get_engine("musetalk"), dh_engine.MuseTalkEngine)

def test_musetalk_installed_reflects_port(monkeypatch):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    monkeypatch.setattr(dh_engine, "_port_listening", lambda port, timeout=0.3: port == 18780)
    assert dh_engine.is_available("musetalk") is True

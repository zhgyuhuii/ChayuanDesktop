"""Unit tests for SadTalker GPU runtime framework registration.

DH-GPU2-T1: 注册 SadTalker 运行时框架 (catalog + 启动 + 安装配方)
"""
from __future__ import annotations


def test_sadtalker_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "sadtalker"), None)
    assert spec is not None
    assert spec.needs_gpu is True
    assert "18680" in spec.default_url


def test_sadtalker_launch_recipe_present():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("sadtalker")
    assert rec is not None and "sadtalker_server" in rec.label


def test_sadtalker_install_recipe_present():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("sadtalker")
    assert any("modelscope" in " ".join(r.cmd) for r in out)


def test_sadtalker_server_imports_clean():
    import importlib
    m = importlib.import_module("chayuan.server.modality.sadtalker_server")
    assert hasattr(m, "main")
    assert hasattr(m, "_register_routes")


import os

def test_sadtalker_engine_forwards(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    posted = {}
    class _Resp:
        status_code = 200
        def json(self): return {"ok": True, "out_path": posted.get("out")}
        def raise_for_status(self): pass
    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, json, timeout=None):
            posted.update(url=url, body=json, out=json["out_path"]); return _Resp()
    monkeypatch.setattr("httpx.Client", _Client)
    monkeypatch.setattr(dh_engine, "_sadtalker_ensure_ready", lambda: None)
    out = os.path.join(tmp_path, "o.mp4"); open(out, "wb").write(b"x")
    e = dh_engine.SadTalkerEngine()
    r = e.generate(avatar_path="img.png", audio_path="a.wav", out_path=out, width=720, height=1280)
    assert r == out
    assert posted["url"].endswith("/infer") and posted["body"]["image_path"] == "img.png"

def test_get_engine_sadtalker_is_real_engine():
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    assert isinstance(dh_engine.get_engine("sadtalker"), dh_engine.SadTalkerEngine)

def test_sadtalker_installed_reflects_port(monkeypatch):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    monkeypatch.setattr(dh_engine, "_port_listening", lambda port, timeout=0.3: True)
    assert dh_engine.is_available("sadtalker") is True
    monkeypatch.setattr(dh_engine, "_port_listening", lambda port, timeout=0.3: False)
    assert dh_engine.is_available("sadtalker") is False

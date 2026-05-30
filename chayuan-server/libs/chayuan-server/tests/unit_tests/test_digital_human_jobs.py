from chayuan.server.video_generation.digital_human import engine as dh_engine
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation import _helpers
import os, uuid

class _FakeEngine:
    def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
        if on_progress: on_progress(50)
        open(out_path, "wb").write(b"mp4")
        return out_path

def test_engine_protocol_shape():
    e = _FakeEngine()
    seen = []
    out = e.generate(avatar_path="a", audio_path="b", out_path="/tmp/o.mp4",
                     width=720, height=1280, on_progress=seen.append)
    assert out.endswith("o.mp4") and seen == [50]

def test_get_engine_returns_wav2lip():
    e = dh_engine.get_engine()
    assert hasattr(e, "generate")


import importlib.util, pytest

@pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="no torch")
def test_wav2lip_module_importable():
    from chayuan.server.video_generation.digital_human.wav2lip import infer
    assert hasattr(infer, "load_models") and hasattr(infer, "run")


def test_job_pipeline_success(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    def fake_tts(text, preset, audio_path):
        open(audio_path, "wb").write(b"wav"); return audio_path
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", fake_tts)
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            if on_progress: on_progress(80)
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda: _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1",
                                      avatar_kind="video").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "你好", "width": 720, "height": 1280}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete" and st.progress == 100
    assert st.result_path and os.path.isfile(st.result_path)


def test_job_pipeline_missing_preset(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": "nope", "text": "x", "width": 720, "height": 1280}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "failed"


def test_job_pipeline_with_product(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    def fake_tts(text, preset, audio_path):
        open(audio_path, "wb").write(b"wav"); return audio_path
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", fake_tts)
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda: _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    monkeypatch.setattr(dh_jobs, "resolve_product_path", lambda ref: str(tmp_path / "prod.png"))
    (tmp_path / "prod.png").write_bytes(b"x")
    called = {}
    def fake_render(**kw):
        called.update(kw); open(kw["out_path"], "wb").write(b"final"); return kw["out_path"]
    monkeypatch.setattr(dh_jobs, "render_with_product", fake_render)
    monkeypatch.setattr(dh_jobs, "_probe_duration_ms", lambda p: 5000)

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "你好", "width": 720, "height": 1280,
                             "product_ref": "product:prod.png", "template": "corner"}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete"
    assert called.get("template") == "corner"
    assert st.result_path.endswith("digital_human.mp4")


def test_job_pipeline_matte(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", lambda t, p, a: (open(a, "wb").write(b"w"), a)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda: _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    monkeypatch.setattr(dh_jobs, "resolve_product_path", lambda ref: str(tmp_path / "p.png"))
    (tmp_path / "p.png").write_bytes(b"x")
    monkeypatch.setattr(dh_jobs, "_probe_duration_ms", lambda p: 4000)
    seen = {"matte": 0, "plain": 0}
    def fake_matte(**kw):
        seen["matte"] += 1; open(kw["out_path"], "wb").write(b"m"); return kw["out_path"]
    def fake_plain(**kw):
        seen["plain"] += 1; open(kw["out_path"], "wb").write(b"p"); return kw["out_path"]
    monkeypatch.setattr(dh_jobs, "render_with_product_matte", fake_matte)
    monkeypatch.setattr(dh_jobs, "render_with_product", fake_plain)

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "hi", "width": 720, "height": 1280,
                             "product_ref": "product:p.png", "template": "bg", "matte": True}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "complete"
    assert seen["matte"] == 1 and seen["plain"] == 0


def test_engine_registry_listing():
    items = dh_engine.list_engines()
    ids = {e["id"] for e in items}
    assert ids == {"wav2lip", "sadtalker", "musetalk"}
    w = next(e for e in items if e["id"] == "wav2lip")
    assert w["builtin"] is True and w["kind"] == "cpu" and w["installed"] is True
    g = next(e for e in items if e["id"] == "sadtalker")
    assert g["builtin"] is False and g["kind"] == "gpu" and g["installed"] is False
    assert g["input"] == "image"
    assert next(e for e in items if e["id"] == "musetalk")["input"] == "video"

def test_get_engine_default_is_wav2lip():
    assert isinstance(dh_engine.get_engine(), dh_engine.Wav2LipEngine)
    assert isinstance(dh_engine.get_engine("wav2lip"), dh_engine.Wav2LipEngine)

def test_get_engine_gpu_placeholder_raises_on_generate():
    e = dh_engine.get_engine("sadtalker")
    assert dh_engine.is_available("sadtalker") is False
    import pytest
    with pytest.raises(RuntimeError, match="未安装"):
        e.generate(avatar_path="a", audio_path="b", out_path="o", width=720, height=1280)

def test_get_engine_unknown_raises():
    import pytest
    with pytest.raises(RuntimeError, match="未知引擎"):
        dh_engine.get_engine("nope")

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

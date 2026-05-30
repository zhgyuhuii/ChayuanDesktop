from chayuan.server.video_generation.digital_human import engine as dh_engine

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

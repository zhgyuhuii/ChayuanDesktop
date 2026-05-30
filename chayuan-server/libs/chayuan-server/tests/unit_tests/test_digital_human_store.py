import os
from chayuan.server.video_generation import _helpers

def test_digital_human_dirs(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    d = _helpers.digital_human_dir(create=True)
    assert os.path.isdir(d)
    assert d.endswith(os.path.join("data", "digital_human"))
    av = _helpers.dh_avatars_dir(create=True)
    assert os.path.isdir(av) and av.endswith(os.path.join("digital_human", "avatars"))
    assert _helpers.dh_presets_path().endswith("presets.json")


from chayuan.server.video_generation.digital_human.schemas import (
    DigitalHumanPreset, DhGenerateRequest, DhTaskStatus,
)

def test_dh_schemas_roundtrip():
    p = DigitalHumanPreset(
        id="p1", name="主播A", avatar_ref="bundled:female1",
        avatar_kind="video", is_greenscreen=False,
        voice_provider="clone", voice_name="clone:abc", created=1.0,
    )
    assert p.model_dump()["name"] == "主播A"
    req = DhGenerateRequest(preset_id="p1", text="你好")
    assert req.template == "none" and req.matte is False
    st = DhTaskStatus(task_id="t1", state="pending", progress=0)
    assert st.state == "pending"

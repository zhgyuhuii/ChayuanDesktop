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

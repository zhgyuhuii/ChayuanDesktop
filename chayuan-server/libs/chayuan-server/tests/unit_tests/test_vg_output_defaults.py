from chayuan.server.video_generation.steps.vg_output_defaults import load_defaults, save_defaults


def test_defaults_default(tmp_path):
    assert load_defaults(str(tmp_path)) == {
        "background_color": "#000000", "intro_clip": None, "outro_clip": None,
    }


def test_defaults_roundtrip(tmp_path):
    root = str(tmp_path)
    save_defaults({"background_color": "#112233", "intro_clip": "a.mp4"}, root)
    d = load_defaults(root)
    assert d["background_color"] == "#112233"
    assert d["intro_clip"] == "a.mp4"
    assert d["outro_clip"] is None


def test_defaults_clear(tmp_path):
    root = str(tmp_path)
    save_defaults({"intro_clip": "a.mp4"}, root)
    save_defaults({"intro_clip": None}, root)
    assert load_defaults(root)["intro_clip"] is None

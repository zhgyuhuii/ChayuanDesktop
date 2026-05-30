from chayuan.server.video_generation.digital_human.compose import build_presenter_edl, TEMPLATES

def test_templates_keys():
    assert set(TEMPLATES) == {"corner", "bg", "side"}
    for v in TEMPLATES.values():
        assert {"x", "y", "scale"} <= set(v)

def test_build_presenter_edl_structure():
    tl = build_presenter_edl("/t/presenter.mp4", "/t/prod.png", "corner", dur_ms=5000)
    vtracks = [t for t in tl.tracks if t.kind == "video"]
    assert len(vtracks) == 2
    base = vtracks[0]; pip = vtracks[1]
    assert base.removable is False and base.clips[0].source["path"] == "/t/prod.png"
    assert pip.removable is True and pip.clips[0].source["path"] == "/t/presenter.mp4"
    c = pip.clips[0]
    assert c.scale == TEMPLATES["corner"]["scale"]
    assert c.out_ms == 5000 and base.clips[0].out_ms == 5000
    assert tl.duration_ms == 5000

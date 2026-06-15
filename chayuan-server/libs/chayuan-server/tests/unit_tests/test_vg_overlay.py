from chayuan.server.video_generation.schemas import VgOverlay, Timeline


def test_overlay_defaults():
    o = VgOverlay(id="o1")
    assert o.type == "text" and o.duration_ms == 3000 and o.font_size == 48


def test_timeline_overlays():
    t = Timeline(overlays=[{"id": "o1", "text": "hi"}])
    assert len(t.overlays) == 1 and t.overlays[0].text == "hi"


def test_hex_rgba():
    from chayuan.server.video_generation.steps.compose import _hex_rgba
    assert _hex_rgba("#ff0000") == (255, 0, 0, 255)
    assert _hex_rgba("bad") is None


def test_shape_image_rect():
    import os as _os
    from chayuan.server.video_generation.steps.compose import _render_shape_image
    from chayuan.server.video_generation.schemas import VgOverlay
    ov = VgOverlay(id="s1", type="rect", w=0.5, h=0.3, fill="#ff0000", stroke_color="#000000", stroke_width=2)
    p = _render_shape_image(ov, 1080, 1920)
    assert p and _os.path.isfile(p)

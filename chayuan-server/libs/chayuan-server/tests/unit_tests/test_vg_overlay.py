from chayuan.server.video_generation.schemas import VgOverlay, Timeline


def test_overlay_defaults():
    o = VgOverlay(id="o1")
    assert o.type == "text" and o.duration_ms == 3000 and o.font_size == 48


def test_timeline_overlays():
    t = Timeline(overlays=[{"id": "o1", "text": "hi"}])
    assert len(t.overlays) == 1 and t.overlays[0].text == "hi"

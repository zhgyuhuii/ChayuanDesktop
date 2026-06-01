from chayuan.server.video_generation.digital_human.compose_multi import _resolve_positions


def test_resolve_positions_normalized():
    pos = [(0.0, 0.0, 0.5), (0.5, 0.25, 0.4)]
    out = _resolve_positions(pos, "side", 2, 1000, 2000)
    assert out[0] == (0, 0, 500)
    assert out[1] == (500, 500, 400)


def test_resolve_positions_fallback_layout():
    out = _resolve_positions(None, "side", 2, 1000, 2000)
    assert len(out) == 2 and out[0][2] == 500

from chayuan.server.video_generation.digital_human.compose_multi import _resolve_positions


def test_resolve_positions_normalized():
    pos = [(0.0, 0.0, 0.5), (0.5, 0.25, 0.4)]
    out = _resolve_positions(pos, "side", 2, 1000, 2000)
    assert out[0] == (0, 0, 500)
    assert out[1] == (500, 500, 400)


def test_resolve_positions_fallback_layout():
    out = _resolve_positions(None, "side", 2, 1000, 2000)
    assert len(out) == 2 and out[0][2] == 500


from chayuan.server.video_generation.digital_human.compose_multi import _turntaking_segments


def test_turntaking_segments():
    unit_roles = [0, 1, 0]
    durs = [1000, 2000, 1500]
    assert _turntaking_segments(unit_roles, durs, 0) == [(True, 1000), (False, 2000), (True, 1500)]
    assert _turntaking_segments(unit_roles, durs, 1) == [(False, 1000), (True, 2000), (False, 1500)]

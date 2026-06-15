from chayuan.server.video_generation.steps.compose import _bg_rgb


class P:
    pass


def test_bg_rgb_hex():
    p = P(); p.background_color = "#ff8800"
    assert _bg_rgb(p) == (255, 136, 0)


def test_bg_rgb_default_black():
    p = P(); p.background_color = "bad"
    assert _bg_rgb(p) == (0, 0, 0)


def test_bg_rgb_missing_attr():
    assert _bg_rgb(P()) == (0, 0, 0)

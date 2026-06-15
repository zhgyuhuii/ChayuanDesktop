from chayuan.server.video_generation.steps.outro import resolve_intro_outro


def test_paid_project_over_global():
    assert resolve_intro_outro(params_intro="p.mp4", params_outro=None,
                               global_intro="g.mp4", global_outro="go.mp4", paid=True) == ("p.mp4", "go.mp4")


def test_paid_fallback_global():
    assert resolve_intro_outro(params_intro=None, params_outro=None,
                               global_intro="g.mp4", global_outro="go.mp4", paid=True) == ("g.mp4", "go.mp4")


def test_nonpaid_blocks_all():
    assert resolve_intro_outro(params_intro="p.mp4", params_outro="o.mp4",
                               global_intro="g.mp4", global_outro="go.mp4", paid=False) == (None, None)

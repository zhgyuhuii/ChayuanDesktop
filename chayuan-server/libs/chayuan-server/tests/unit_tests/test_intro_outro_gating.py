from chayuan.server.video_generation.steps.outro import resolve_intro_outro, _fit_chain


def test_paid_project_over_global():
    assert resolve_intro_outro(params_intro="p.mp4", params_outro=None,
                               global_intro="g.mp4", global_outro="go.mp4", paid=True) == ("p.mp4", "go.mp4")


def test_paid_fallback_global():
    assert resolve_intro_outro(params_intro=None, params_outro=None,
                               global_intro="g.mp4", global_outro="go.mp4", paid=True) == ("g.mp4", "go.mp4")


def test_nonpaid_blocks_all():
    assert resolve_intro_outro(params_intro="p.mp4", params_outro="o.mp4",
                               global_intro="g.mp4", global_outro="go.mp4", paid=False) == (None, None)


def test_fit_chain_blur_has_no_black_frame():
    """默认 blur:模糊铺底 + 居中适配,绝不出现纯黑补边('框'根因)。"""
    fc = _fit_chain("[1:v]", "[v1]", w=1080, h=1920, fps="30", mode="blur")
    assert "color=black" not in fc and "pad=" not in fc
    assert "split=2" in fc and "boxblur" in fc and "overlay=" in fc
    # 中间标签需唯一派生,避免与主链冲突
    assert "[v1bg]" in fc and "[v1fg]" in fc and fc.endswith("[v1]")


def test_fit_chain_pad_keeps_color():
    """pad 模式保留旧行为(纯色补边),颜色透传。"""
    fc = _fit_chain("[1:v]", "[ve]", w=1080, h=1920, fps="30", mode="pad", pad="0xffffff")
    assert "pad=1080:1920" in fc and "color=0xffffff" in fc and "split" not in fc


def test_fit_chain_cover_fills_no_pad():
    fc = _fit_chain("[1:v]", "[ve]", w=1080, h=1920, fps="30", mode="cover")
    assert "force_original_aspect_ratio=increase" in fc and "crop=1080:1920" in fc
    assert "pad=" not in fc and "split" not in fc

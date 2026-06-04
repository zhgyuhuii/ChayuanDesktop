from chayuan.server.video_generation.digital_human import subtitle_ass as S


def test_build_ass(tmp_path):
    cues = [{"start_ms": 0, "end_ms": 1500, "text": "你好"}]
    style = {"font_size": 60, "text_fore_color": "#FFFFFF", "subtitle_position": "bottom"}
    p = S.build_ass(cues, style, str(tmp_path / "s.ass"), width=1080, height=1920, font_path="/f/msyh.ttc")
    t = open(p, encoding="utf-8").read()
    assert "[Script Info]" in t and "你好" in t
    assert "0:00:00.00,0:00:01.50" in t
    assert "msyh" in t           # fontname 取自 font_path


def test_color_and_align():
    assert S._hex_to_ass("#FF0000") == "&H000000FF"   # RGB→BGR
    style = {"subtitle_position": "top"}
    import tempfile, os
    d = tempfile.mkdtemp()
    p = S.build_ass([], style, os.path.join(d, "a.ass"), width=100, height=100)
    assert ",8," in open(p, encoding="utf-8").read()   # top → Alignment 8

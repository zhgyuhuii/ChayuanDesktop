from chayuan.server.video_generation.digital_human import ffcompose as F


def test_build_filter_single_layer():
    scene = {"width": 1080, "height": 1920, "duration_ms": 4000, "audio_path": "/a.wav",
             "layers": [{"src": "/p.mp4", "kind": "video", "x": 0.0, "y": 0.0,
                         "scale": 1.0, "z": 0, "opacity": None, "loop": True, "windows": None}],
             "subtitle": None}
    fc, inputs, vlabel, _ = F.build_filter(scene)
    assert "color=c=black:s=1080x1920" in fc
    assert "scale=1080" in fc
    assert "overlay=0:0" in fc
    assert inputs[0]["path"] == "/p.mp4" and inputs[0]["loop"] is True


def test_build_filter_opacity_and_pos():
    scene = {"width": 1000, "height": 1000, "duration_ms": 2000, "audio_path": "/a.wav",
             "layers": [{"src": "/x.png", "kind": "image", "x": 0.5, "y": 0.25,
                         "scale": 0.3, "z": 1, "opacity": 0.6, "loop": False, "windows": None}],
             "subtitle": None}
    fc, *_ = F.build_filter(scene)
    assert "colorchannelmixer=aa=0.6" in fc
    assert "overlay=500:250" in fc
    assert "scale=300" in fc


def test_build_filter_window_enable():
    scene = {"width": 100, "height": 100, "duration_ms": 5000, "audio_path": "/a.wav",
             "layers": [{"src": "/s.mp4", "kind": "video", "x": 0, "y": 0, "scale": 1.0,
                         "z": 0, "opacity": None, "loop": False,
                         "windows": [{"start_ms": 1000, "end_ms": 2000}]}],
             "subtitle": None}
    fc, *_ = F.build_filter(scene)
    assert "enable='between(t,1.0,2.0)'" in fc


def test_build_filter_z_order_and_subtitle():
    scene = {"width": 100, "height": 100, "duration_ms": 1000, "audio_path": "/a.wav",
             "layers": [{"src": "/top.png", "kind": "image", "x": 0, "y": 0, "scale": 1, "z": 5,
                         "opacity": None, "loop": False, "windows": None},
                        {"src": "/bot.png", "kind": "image", "x": 0, "y": 0, "scale": 1, "z": 0,
                         "opacity": None, "loop": False, "windows": None}],
             "subtitle": {"ass_path": "/t/s.ass"}}
    fc, inputs, vlabel, _ = F.build_filter(scene)
    assert inputs[0]["path"] == "/bot.png"   # z 升序:低 z 先叠(底)
    assert inputs[1]["path"] == "/top.png"
    assert vlabel == "vout" and "subtitles=" in fc

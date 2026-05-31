from chayuan.server.video_generation.digital_human.timeline_bridge import (
    build_cues_from_script, build_timeline,
)


def test_build_cues_from_script():
    cues = build_cues_from_script("你好。今天天气很好!很高兴见到你。", 10000)
    assert len(cues) >= 2
    assert cues[0].start_ms == 0
    assert cues[-1].end_ms == 10000
    for a, b in zip(cues, cues[1:]):
        assert b.start_ms >= a.start_ms


def test_build_cues_empty():
    assert build_cues_from_script("", 5000) == []
    assert build_cues_from_script("你好", 0) == []


def test_build_timeline_structure():
    cues = build_cues_from_script("你好。世界!", 4000)
    tl = build_timeline("/x/out.mp4", cues, 4000)
    assert tl.duration_ms == 4000
    kinds = [t.kind for t in tl.tracks]
    assert "video" in kinds and "subtitle" in kinds
    vid = next(t for t in tl.tracks if t.kind == "video")
    assert vid.clips[0].source["path"] == "/x/out.mp4" and vid.clips[0].out_ms == 4000
    sub = next(t for t in tl.tracks if t.kind == "subtitle")
    assert len(sub.cues) == len(cues)

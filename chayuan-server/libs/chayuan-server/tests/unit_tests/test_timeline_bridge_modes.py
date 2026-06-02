from chayuan.server.video_generation.digital_human.timeline_bridge import build_timeline_for_mode


class _Slot:
    def __init__(self, name, x=0.0, y=0.0, scale=1.0):
        self.name = name
        self.x = x
        self.y = y
        self.scale = scale
        self.ref = "r"


def _segs():
    return [
        {"role_index": 0, "material_id": "m0", "path": "/a/s0.mp4", "text": "甲一", "duration_ms": 1000},
        {"role_index": 1, "material_id": "m1", "path": "/a/s1.mp4", "text": "乙一", "duration_ms": 2000},
        {"role_index": 0, "material_id": "m2", "path": "/a/s2.mp4", "text": "甲二", "duration_ms": 1500},
    ]


def test_single():
    tl = build_timeline_for_mode("single", result_material_id="rm", result_path="/a/r.mp4",
                                 segments=[], slots=[_Slot("A")], total_ms=5000, script="你好。再见。")
    kinds = [t.kind for t in tl.tracks]
    assert "video" in kinds and "subtitle" in kinds
    vt = [t for t in tl.tracks if t.kind == "video"][0]
    assert len(vt.clips) == 1


def test_coframe_layout_and_offsets():
    tl = build_timeline_for_mode("coframe", result_material_id="rm", result_path="/a/r.mp4",
                                 segments=_segs(),
                                 slots=[_Slot("A", 0.1, 0.1, 0.5), _Slot("B", 0.6, 0.1, 0.5)],
                                 total_ms=4500, script="")
    vids = [t for t in tl.tracks if t.kind == "video"]
    main = [t for t in vids if t.id == "dh-main"][0]
    assert main.clips == []                      # 主轨空
    roleA = [t for t in vids if t.id == "dh-role-0"][0]
    roleB = [t for t in vids if t.id == "dh-role-1"][0]
    assert [c.track_start_ms for c in roleA.clips] == [0, 3000]   # 甲一@0, 甲二@(1000+2000)
    assert [c.track_start_ms for c in roleB.clips] == [1000]      # 乙一@1000
    assert roleA.clips[0].scale == 0.5 and roleA.clips[0].x == 0.1  # PIP 定位
    sub = [t for t in tl.tracks if t.kind == "subtitle"][0]
    assert [c.text for c in sub.cues] == ["A: 甲一", "B: 乙一", "A: 甲二"]
    assert [(c.start_ms, c.end_ms) for c in sub.cues] == [(0, 1000), (1000, 3000), (3000, 4500)]


def test_sequential_fullscreen():
    tl = build_timeline_for_mode("sequential", result_material_id="rm", result_path="/a/r.mp4",
                                 segments=_segs(), slots=[_Slot("A"), _Slot("B")],
                                 total_ms=4500, script="")
    roleA = [t for t in tl.tracks if t.id == "dh-role-0"][0]
    assert roleA.clips[0].scale == 1.0 and roleA.clips[0].x == 0.0   # 全屏


def test_no_segments_falls_back_single():
    tl = build_timeline_for_mode("coframe", result_material_id="rm", result_path="/a/r.mp4",
                                 segments=[], slots=[_Slot("A"), _Slot("B")],
                                 total_ms=3000, script="你好。")
    vids = [t for t in tl.tracks if t.kind == "video"]
    assert len(vids) == 1 and len(vids[0].clips) == 1   # 退回单片

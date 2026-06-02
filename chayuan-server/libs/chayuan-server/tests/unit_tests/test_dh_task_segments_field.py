def test_task_status_segments_default():
    from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
    s = DhTaskStatus(task_id="t", state="complete")
    assert s.segments == []


def test_task_status_segments_roundtrip():
    from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
    s = DhTaskStatus(
        task_id="t", state="complete",
        segments=[{"role_index": 0, "path": "/x/seg0.mp4", "text": "hi", "duration_ms": 1200}],
    )
    assert s.segments[0]["role_index"] == 0 and s.segments[0]["duration_ms"] == 1200

from chayuan.server.video_generation.schemas import (
    Timeline, TimelineTrack, TimelineClip, VideoParams,
)


def test_timeline_clip_defaults():
    c = TimelineClip(id="c1", source={"path": "/tmp/a.mp4"}, track_start_ms=0, out_ms=5000)
    assert c.in_ms == 0
    assert c.out_ms == 5000
    assert c.transition == "none"


def test_timeline_parse_full():
    tl = Timeline(
        duration_ms=8000,
        tracks=[
            TimelineTrack(id="v", kind="video", clips=[
                TimelineClip(id="c1", source={"material_id": "m1"}, track_start_ms=0, in_ms=0, out_ms=3000),
                TimelineClip(id="c2", source={"path": "/x/b.mp4"}, track_start_ms=3000, in_ms=1000, out_ms=6000),
            ]),
        ],
    )
    assert tl.tracks[0].kind == "video"
    assert len(tl.tracks[0].clips) == 2
    assert tl.tracks[0].clips[1].in_ms == 1000


def test_videoparams_timeline_optional():
    p = VideoParams(video_subject="x")
    assert p.timeline is None  # 缺省不破现有 VideoParams

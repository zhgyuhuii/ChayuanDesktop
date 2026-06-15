"""P2 几何变换:TimelineClip 字段 + _build_pip_layers 携带 + _apply_pip_geometry。"""
from chayuan.server.video_generation.schemas import (
    CropRect, Timeline, TimelineClip, TimelineTrack,
)


def test_clip_geometry_defaults():
    c = TimelineClip(id="x", source={}, track_start_ms=0)
    assert c.rotation == 0.0
    assert c.flip_h is False and c.flip_v is False
    assert c.crop is None


def test_clip_geometry_set():
    c = TimelineClip(
        id="x", source={}, track_start_ms=0,
        rotation=90.0, flip_h=True,
        crop={"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.5},
    )
    assert c.rotation == 90.0 and c.flip_h is True
    assert isinstance(c.crop, CropRect) and c.crop.w == 0.5


def test_pip_layers_carry_geometry():
    from chayuan.server.video_generation.steps.compose import _build_pip_layers
    tl = Timeline(tracks=[
        TimelineTrack(id="main", kind="video", clips=[
            TimelineClip(id="m", source={"path": "/x.mp4"}, track_start_ms=0)]),
        TimelineTrack(id="pip", kind="video", clips=[
            TimelineClip(id="p", source={"path": "/p.mp4"}, track_start_ms=0, out_ms=2000,
                         rotation=45.0, flip_h=True,
                         crop={"x": 0.1, "y": 0.0, "w": 0.8, "h": 0.9})]),
    ])
    layers = _build_pip_layers(tl, source_resolver=lambda s: s.get("path", ""))
    assert len(layers) == 1
    ly = layers[0]
    assert ly["rotation"] == 45.0 and ly["flip_h"] is True and ly["flip_v"] is False
    assert ly["crop"] == {"x": 0.1, "y": 0.0, "w": 0.8, "h": 0.9}


def test_edl_plan_carries_geometry():
    from chayuan.server.video_generation.steps.compose import _build_edl_render_plan
    tl = Timeline(tracks=[TimelineTrack(id="main", kind="video", clips=[
        TimelineClip(id="m", source={"path": "/x.mp4"}, track_start_ms=0, out_ms=3000,
                     rotation=90.0, scale=0.5, x=0.2, opacity=0.8,
                     crop={"x": 0, "y": 0, "w": 0.5, "h": 1})])])
    plan = _build_edl_render_plan(tl, "9:16", source_resolver=lambda s: s.get("path", ""))
    assert plan and plan[0]["rotation"] == 90.0 and plan[0]["scale"] == 0.5
    assert plan[0]["opacity"] == 0.8 and plan[0]["crop"] == {"x": 0, "y": 0, "w": 0.5, "h": 1}

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


def test_render_main_segment_routes_by_geometry():
    """主轨单段:无变换 -> 直接 resize 填满;有 scale/位置 -> 合成黑底(非全屏)。"""
    from moviepy import ColorClip
    from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
    from chayuan.server.video_generation.steps.compose import _render_main_segment

    clip = ColorClip((120, 90), color=(255, 0, 0)).with_duration(1.0)
    # 无几何 -> 满画幅(零回归路径)
    full = _render_main_segment(clip, {}, 200, 400)
    assert tuple(full.size) == (200, 400)
    assert not isinstance(full, CompositeVideoClip)
    # 有缩放/定位 -> 合成画布(画布满 W×H,但内层被缩放定位,即非铺满素材)
    comp = _render_main_segment(clip, {"scale": 0.5, "x": 0.1, "y": 0.2}, 200, 400)
    assert isinstance(comp, CompositeVideoClip)
    assert tuple(comp.size) == (200, 400)
    inner = comp.clips[-1]
    assert inner.size[0] == int(200 * 0.5)            # 内层按画布宽缩放
    assert tuple(inner.pos(0)) == (int(0.1 * 200), int(0.2 * 400))


def test_proxy_main_track_applies_geometry(monkeypatch, tmp_path):
    """代理预览主轨段必须经 _render_main_segment(几何),不得直接 resize 铺满全屏(本 bug 回归)。"""
    from chayuan.server.video_generation.steps import compose as C

    calls = []

    class _FakeSeg:
        def write_videofile(self, *a, **k):
            pass

    def _spy_main(clip, item, w, h, bg=(0, 0, 0)):
        calls.append({"item": item, "w": w, "h": h})
        return _FakeSeg()

    class _FakeClip:
        duration = 5.0
        def with_duration(self, *_a):
            return self
        def subclipped(self, *_a):
            return self

    monkeypatch.setattr(C, "_render_main_segment", _spy_main)
    monkeypatch.setattr(C, "_open_video_clip_quietly", lambda *_a, **_k: _FakeClip())
    monkeypatch.setattr(C, "ImageClip", lambda *_a, **_k: _FakeClip())
    monkeypatch.setattr(C, "close_clip", lambda *_a, **_k: None)
    monkeypatch.setattr(C, "concat_video_clips_with_ffmpeg", lambda *_a, **_k: None)

    tl = Timeline(tracks=[TimelineTrack(id="main", kind="video", clips=[
        TimelineClip(id="m", source={"path": "/x.mp4"}, track_start_ms=0, out_ms=3000,
                     scale=0.5, x=0.2, y=0.1)])])
    out = str(tmp_path / "proxy.mp4")
    C.render_proxy_from_timeline(
        tl, "9:16", out, source_resolver=lambda s: s.get("path", ""),
    )
    assert len(calls) == 1, "主轨 clip 必须经 _render_main_segment 渲染"
    assert calls[0]["item"]["scale"] == 0.5 and calls[0]["item"]["x"] == 0.2

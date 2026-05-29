import sys
import types

# compose.py 顶层依赖 moviepy(运行时包,单测环境未安装) — 用轻量 stub 骗过 import。
# _build_edl_render_plan 是纯函数,不使用任何 moviepy 对象。
for _mod in [
    "moviepy",
    "moviepy.video",
    "moviepy.video.tools",
    "moviepy.video.tools.subtitles",
    "moviepy.afx",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = types.ModuleType(_mod)

# moviepy 顶级命名空间需要的符号
_mp = sys.modules["moviepy"]
for _sym in [
    "AudioFileClip", "ColorClip", "CompositeAudioClip", "CompositeVideoClip",
    "ImageClip", "TextClip", "VideoFileClip", "afx",
]:
    setattr(_mp, _sym, None)

# SubtitlesClip
sys.modules["moviepy.video.tools.subtitles"].SubtitlesClip = None  # type: ignore[assignment]

# _video_effects — compose.py 做 ``from .. import _video_effects as video_effects``
import chayuan.server.video_generation as _vg_pkg  # noqa: E402
if not hasattr(_vg_pkg, "_video_effects"):
    _ve = types.ModuleType("chayuan.server.video_generation._video_effects")
    sys.modules["chayuan.server.video_generation._video_effects"] = _ve
    _vg_pkg._video_effects = _ve  # type: ignore[attr-defined]

from chayuan.server.video_generation.schemas import (
    Timeline, TimelineTrack, TimelineClip, VideoParams,
)
from chayuan.server.video_generation.steps.compose import _build_edl_render_plan
from chayuan.server.video_generation.schemas import VideoAspect


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


def _src_resolver(source):
    # 测试用解析器:material_id -> 假路径;path 直通
    if source.get("material_id"):
        return f"/lib/{source['material_id']}.mp4"
    return source.get("path") or source.get("url") or ""


def test_edl_render_plan_order_and_subclip():
    tl = Timeline(tracks=[TimelineTrack(id="v", kind="video", clips=[
        TimelineClip(id="c2", source={"path": "/x/b.mp4"}, track_start_ms=3000, in_ms=1000, out_ms=4000),
        TimelineClip(id="c1", source={"material_id": "m1"}, track_start_ms=0, in_ms=0, out_ms=3000),
    ])])
    plan = _build_edl_render_plan(tl, VideoAspect.portrait, source_resolver=_src_resolver)
    assert [p["clip_id"] for p in plan] == ["c1", "c2"]
    assert plan[0]["path"] == "/lib/m1.mp4"
    assert plan[0]["start_s"] == 0.0 and plan[0]["end_s"] == 3.0
    assert plan[1]["path"] == "/x/b.mp4"
    assert plan[1]["start_s"] == 1.0 and plan[1]["end_s"] == 4.0
    assert plan[0]["target_w"] == 1080 and plan[0]["target_h"] == 1920


def test_edl_render_plan_skips_empty_source_and_zero_out():
    tl = Timeline(tracks=[TimelineTrack(id="v", kind="video", clips=[
        TimelineClip(id="bad", source={}, track_start_ms=0, out_ms=3000),
        TimelineClip(id="ok", source={"path": "/x/c.mp4"}, track_start_ms=0, in_ms=0, out_ms=0),
    ])])
    plan = _build_edl_render_plan(tl, VideoAspect.portrait, source_resolver=_src_resolver)
    assert [p["clip_id"] for p in plan] == ["ok"]
    assert plan[0]["end_s"] is None

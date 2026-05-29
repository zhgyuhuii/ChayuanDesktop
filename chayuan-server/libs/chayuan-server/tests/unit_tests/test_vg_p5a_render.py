import sys
import types

# dev 机可能没装 moviepy(compose.py 顶层 import 它)。_build_edl_render_plan 是纯逻辑
# 不用 moviepy —— 缺失时打桩让纯逻辑测试在本机也能跑;真环境有 moviepy 则桩不生效。
try:  # pragma: no cover
    import moviepy  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover
    _mp = types.ModuleType("moviepy")
    _mp.__getattr__ = lambda _name: object  # 任意名(Clip/vfx/afx/...)都给个占位
    sys.modules["moviepy"] = _mp
    _sub = types.ModuleType("moviepy.video.tools.subtitles")
    _sub.SubtitlesClip = object
    sys.modules["moviepy.video"] = types.ModuleType("moviepy.video")
    sys.modules["moviepy.video.tools"] = types.ModuleType("moviepy.video.tools")
    sys.modules["moviepy.video.tools.subtitles"] = _sub

from chayuan.server.video_generation.steps.compose import _build_edl_render_plan
from chayuan.server.video_generation.schemas import Timeline


def _tl(clips):
    return Timeline.model_validate({
        "version": 1, "duration_ms": 0,
        "tracks": [{"id": "v", "kind": "video", "clips": clips}],
    })


def test_plan_marks_image_by_extension():
    tl = _tl([
        {"id": "a", "source": {"path": "/m/a.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0},
        {"id": "b", "source": {"path": "/m/b.jpg"}, "track_start_ms": 5000, "in_ms": 0, "out_ms": 3000},
    ])
    plan = _build_edl_render_plan(tl, "9:16", source_resolver=lambda s: s.get("path", ""))
    assert plan[0]["is_image"] is False
    assert plan[1]["is_image"] is True
    assert plan[1]["end_s"] == 3.0
    assert plan[0]["end_s"] is None


def test_plan_image_default_duration_when_no_out():
    tl = _tl([{"id": "c", "source": {"path": "/m/c.png"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}])
    plan = _build_edl_render_plan(tl, "9:16", source_resolver=lambda s: s.get("path", ""))
    assert plan[0]["is_image"] is True
    assert plan[0]["end_s"] == 3.0

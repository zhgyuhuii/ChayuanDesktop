import sys
import types

try:  # pragma: no cover
    import moviepy  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover
    _mp = types.ModuleType("moviepy")
    _mp.__getattr__ = lambda _n: object
    sys.modules["moviepy"] = _mp
    _sub = types.ModuleType("moviepy.video.tools.subtitles")
    _sub.SubtitlesClip = object
    sys.modules["moviepy.video"] = types.ModuleType("moviepy.video")
    sys.modules["moviepy.video.tools"] = types.ModuleType("moviepy.video.tools")
    sys.modules["moviepy.video.tools.subtitles"] = _sub

from chayuan.server.video_generation.schemas import Timeline


def test_clip_accepts_pip_fields_and_track_removable():
    tl = Timeline.model_validate({
        "version": 1, "tracks": [
            {"id": "v", "kind": "video", "clips": [{"id": "a", "source": {"path": "/a.mp4"}, "track_start_ms": 0}]},
            {"id": "v2", "kind": "video", "removable": True, "clips": [
                {"id": "p", "source": {"path": "/p.mp4"}, "track_start_ms": 0, "x": 0.6, "y": 0.05, "scale": 0.35, "z": 2},
            ]},
        ],
    })
    pip = tl.tracks[1].clips[0]
    assert (pip.x, pip.y, pip.scale, pip.z) == (0.6, 0.05, 0.35, 2)
    assert tl.tracks[1].removable is True
    assert tl.tracks[0].removable is False

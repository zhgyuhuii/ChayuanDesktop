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


from chayuan.server.video_generation.steps.compose import _build_pip_layers


def _tl_pip(pip_clips):
    tracks = [{"id": "v", "kind": "video", "clips": [{"id": "base", "source": {"path": "/base.mp4"}, "track_start_ms": 0}]}]
    tracks.append({"id": "v2", "kind": "video", "removable": True, "clips": pip_clips})
    return Timeline.model_validate({"version": 1, "tracks": tracks})


def test_build_pip_layers_takes_extra_video_tracks_sorted_by_z():
    tl = _tl_pip([
        {"id": "p1", "source": {"path": "/p1.png"}, "track_start_ms": 1000, "out_ms": 3000, "x": 0.6, "y": 0.1, "scale": 0.3, "z": 5},
        {"id": "p2", "source": {"path": "/p2.mp4"}, "track_start_ms": 0, "out_ms": 0, "x": 0.0, "y": 0.0, "scale": 0.4, "z": 1},
    ])
    layers = _build_pip_layers(tl, source_resolver=lambda s: s.get("path", ""))
    assert [ly["path"] for ly in layers] == ["/p2.mp4", "/p1.png"]
    p1 = layers[1]
    assert (p1["x"], p1["y"], p1["scale"]) == (0.6, 0.1, 0.3)
    assert p1["is_image"] is True
    assert p1["start_s"] == 1.0 and p1["dur"] == 3.0


def test_build_pip_layers_ignores_main_track_and_unresolved():
    tl = _tl_pip([{"id": "p", "source": {"material_id": "gone"}, "track_start_ms": 0}])
    assert _build_pip_layers(tl, source_resolver=lambda _s: "") == []
    only_main = Timeline.model_validate({"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [{"id": "b", "source": {"path": "/b.mp4"}, "track_start_ms": 0}]}]})
    assert _build_pip_layers(only_main, source_resolver=lambda s: s.get("path", "")) == []

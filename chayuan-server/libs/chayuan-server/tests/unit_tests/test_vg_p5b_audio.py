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

from chayuan.server.video_generation.steps.compose import _build_extra_audios
from chayuan.server.video_generation.schemas import Timeline


def _tl(audio_clips):
    return Timeline.model_validate({
        "version": 1, "duration_ms": 0,
        "tracks": [
            {"id": "v", "kind": "video", "clips": []},
            {"id": "a", "kind": "audio", "clips": audio_clips},
        ],
    })


def test_extra_audios_extracts_audio_track():
    tl = _tl([
        {"id": "x", "source": {"path": "/m/x.mp3"}, "track_start_ms": 2000, "in_ms": 0, "out_ms": 0, "volume": 0.5},
        {"id": "y", "source": {"path": "/m/y.wav"}, "track_start_ms": 8000, "in_ms": 0, "out_ms": 0},
    ])
    out = _build_extra_audios(tl, source_resolver=lambda s: s.get("path", ""))
    assert out == [
        {"path": "/m/x.mp3", "start_s": 2.0, "volume": 0.5},
        {"path": "/m/y.wav", "start_s": 8.0, "volume": 1.0},
    ]


def test_extra_audios_skips_unresolved():
    tl = _tl([{"id": "z", "source": {"material_id": "gone"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}])
    out = _build_extra_audios(tl, source_resolver=lambda _s: "")
    assert out == []


def test_extra_audios_empty_when_no_audio_track():
    tl = Timeline.model_validate({"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": []}]})
    assert _build_extra_audios(tl, source_resolver=lambda s: s.get("path", "")) == []

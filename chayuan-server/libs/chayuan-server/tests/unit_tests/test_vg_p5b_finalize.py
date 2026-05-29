import os
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

from chayuan.server.video_generation.steps.compose import cues_to_srt
from chayuan.server.video_generation import service


def test_cues_to_srt_format():
    srt = cues_to_srt([
        {"startMs": 0, "endMs": 2500, "text": "你好"},
        {"startMs": 2500, "endMs": 5000, "text": "世界"},
    ])
    assert "1\n00:00:00,000 --> 00:00:02,500\n你好" in srt
    assert "2\n00:00:02,500 --> 00:00:05,000\n世界" in srt


def _draft_row():
    return {
        "task_id": "d1", "owner_id": 1, "state": "complete", "stop_at": "subtitle",
        "params": {"video_subject": "t", "video_script": "hi"},
        "result": {"audio_file": "/d/a.mp3", "subtitle_path": "/d/s.srt"},
    }


_TL = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [
    {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}]}]}


def test_finalize_with_cues_writes_srt_and_overrides(monkeypatch, tmp_path):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    monkeypatch.setattr(service.tasks_store, "update_progress", lambda *a, **k: True)
    monkeypatch.setattr(service, "task_dir", lambda *a, **k: str(tmp_path))
    captured = {}
    monkeypatch.setattr(service.runner, "enqueue_finalize",
                        lambda t, p, *, audio_file, subtitle_path: captured.update(subtitle_path=subtitle_path))
    ok = service.finalize_task("d1", _TL, owner_id=1, subtitle_cues=[
        {"startMs": 0, "endMs": 1000, "text": "改过的字幕"},
    ])
    assert ok is True
    assert captured["subtitle_path"] != "/d/s.srt"
    assert os.path.isfile(captured["subtitle_path"])
    assert "改过的字幕" in open(captured["subtitle_path"], encoding="utf-8").read()


def test_finalize_without_cues_uses_draft_srt(monkeypatch, tmp_path):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    monkeypatch.setattr(service.tasks_store, "update_progress", lambda *a, **k: True)
    monkeypatch.setattr(service, "task_dir", lambda *a, **k: str(tmp_path))
    captured = {}
    monkeypatch.setattr(service.runner, "enqueue_finalize",
                        lambda t, p, *, audio_file, subtitle_path: captured.update(subtitle_path=subtitle_path))
    assert service.finalize_task("d1", _TL, owner_id=1) is True
    assert captured["subtitle_path"] == "/d/s.srt"


def test_finalize_sets_stop_at_video(monkeypatch, tmp_path):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    monkeypatch.setattr(service, "task_dir", lambda *a, **k: str(tmp_path))
    monkeypatch.setattr(service.runner, "enqueue_finalize", lambda *a, **k: None)
    seen = {}
    monkeypatch.setattr(service.tasks_store, "update_progress",
                        lambda task_id, **k: seen.update(k) or True)
    service.finalize_task("d1", _TL, owner_id=1)
    assert seen.get("stop_at") == "video"

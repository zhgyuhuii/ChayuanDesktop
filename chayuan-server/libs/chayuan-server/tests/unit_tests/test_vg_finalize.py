from unittest import mock

import pytest

from chayuan.server.video_generation import service, runner
from chayuan.server.video_generation.schemas import VideoParams


def _draft_row():
    return {
        "task_id": "draft-1",
        "owner_id": 1,
        "state": "complete",
        "stop_at": "materials",
        "params": VideoParams(video_subject="t", video_script="hi").model_dump(mode="json"),
        "result": {
            "audio_file": "/d/a.mp3",
            "subtitle_path": "/d/s.srt",
            "materials": ["/d/m0.mp4"],
        },
    }


def test_finalize_task_enqueues_compose_only(monkeypatch):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    upd = mock.Mock(return_value=True)
    monkeypatch.setattr(service.tasks_store, "update_progress", upd)
    enq = mock.Mock()
    monkeypatch.setattr(service.runner, "enqueue_finalize", enq)

    tl = {"version": 1, "duration_ms": 0, "tracks": [{"id": "v", "kind": "video", "clips": [
        {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}]}]}
    ok = service.finalize_task("draft-1", tl, owner_id=1)
    assert ok is True
    enq.assert_called_once()
    args, kwargs = enq.call_args
    assert args[0] == "draft-1"
    assert kwargs["audio_file"] == "/d/a.mp3"
    assert kwargs["subtitle_path"] == "/d/s.srt"
    assert args[1].timeline is not None


def test_finalize_task_missing_draft_returns_false(monkeypatch):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: None)
    assert service.finalize_task("nope", {"version": 1, "tracks": []}, owner_id=1) is False


def test_finalize_task_no_audio_returns_false(monkeypatch):
    row = _draft_row()
    row["result"] = {"materials": ["/d/m0.mp4"]}
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: row)
    assert service.finalize_task("draft-1", {"version": 1, "tracks": []}, owner_id=1) is False


def test_run_finalize_does_not_call_tts(monkeypatch):
    monkeypatch.setattr(runner, "_is_canceled", lambda _t: False)
    monkeypatch.setattr(runner.tasks_store, "update_progress", lambda *a, **k: True)
    composed = mock.Mock(return_value="/d/final-0.mp4")
    monkeypatch.setattr(runner, "_compose_via_edl", composed)
    monkeypatch.setattr(runner, "_persist_vg_videos", mock.Mock())
    monkeypatch.setattr(runner, "_mark_complete", mock.Mock())
    params = VideoParams(video_subject="t", video_script="hi")
    runner._run_finalize("draft-1", params, audio_file="/d/a.mp3", subtitle_path="/d/s.srt")
    composed.assert_called_once()


def test_finalize_relaxed_no_materials_but_timeline_has_clip(monkeypatch):
    row = _draft_row()
    row["result"] = {"audio_file": "/d/a.mp3", "subtitle_path": "/d/s.srt"}  # 无 materials
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: row)
    monkeypatch.setattr(service.tasks_store, "update_progress", lambda *a, **k: True)
    monkeypatch.setattr(service.runner, "enqueue_finalize", lambda *a, **k: None)
    tl = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [
        {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0},
    ]}]}
    assert service.finalize_task("draft-1", tl, owner_id=1) is True


def test_finalize_rejects_empty_video_track(monkeypatch):
    row = _draft_row()
    row["result"] = {"audio_file": "/d/a.mp3", "subtitle_path": "/d/s.srt"}
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: row)
    tl = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": []}]}
    assert service.finalize_task("draft-1", tl, owner_id=1) is False

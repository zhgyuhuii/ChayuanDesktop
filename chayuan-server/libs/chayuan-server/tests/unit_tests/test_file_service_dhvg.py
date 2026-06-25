# tests/unit_tests/test_file_service_dhvg.py
import pytest
from chayuan.server.file_service.base import FileRequestError


def test_dh_avatar_missing_ref():
    from chayuan.server.file_service.adapters.dh import DhAvatarAdapter
    with pytest.raises(FileRequestError) as ei:
        DhAvatarAdapter().handle({}, {"id": "u"}, download=False)
    assert ei.value.status_code == 400


def test_dh_avatar_not_found(monkeypatch):
    from chayuan.server.file_service.adapters import dh as mod
    from chayuan.server.file_service.adapters.dh import DhAvatarAdapter
    monkeypatch.setattr(mod.dh_store, "resolve_avatar_path", lambda r: None)
    with pytest.raises(FileRequestError) as ei:
        DhAvatarAdapter().handle({"ref": "user:x"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404


def test_dh_avatar_ok(monkeypatch, tmp_path):
    from chayuan.server.file_service.adapters import dh as mod
    from chayuan.server.file_service.adapters.dh import DhAvatarAdapter
    p = tmp_path / "a.png"; p.write_bytes(b"x")
    monkeypatch.setattr(mod.dh_store, "resolve_avatar_path", lambda r: str(p))
    from fastapi.responses import FileResponse
    assert isinstance(DhAvatarAdapter().handle({"ref": "user:a"}, {"id": "u"}, download=False), FileResponse)


def test_dh_task_not_ready(monkeypatch):
    from chayuan.server.file_service.adapters import dh as mod
    from chayuan.server.file_service.adapters.dh import DhTaskAdapter
    class _St:  state = "running"; result_path = ""
    monkeypatch.setattr(mod.dh_jobs, "get_status", lambda tid, oid: _St())
    monkeypatch.setattr(mod, "owner_id_of", lambda u: None)
    with pytest.raises(FileRequestError) as ei:
        DhTaskAdapter().handle({"task_id": "t1"}, {"id": "u"}, download=True)
    assert ei.value.status_code == 404


def test_vg_task_missing_params():
    from chayuan.server.file_service.adapters.vg import VgTaskAdapter
    with pytest.raises(FileRequestError) as ei:
        VgTaskAdapter().handle({"task_id": "t"}, {"id": "u"}, download=False)  # 缺 file
    assert ei.value.status_code == 400


def test_vg_task_not_found(monkeypatch):
    from chayuan.server.file_service.adapters import vg as mod
    from chayuan.server.file_service.adapters.vg import VgTaskAdapter
    monkeypatch.setattr(mod.vg_service, "get_task", lambda tid, owner_id=None: None)
    monkeypatch.setattr(mod, "owner_id_of", lambda u: None)
    with pytest.raises(FileRequestError) as ei:
        VgTaskAdapter().handle({"task_id": "t", "file": "a.mp4"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404


def test_vg_bgm_not_found(monkeypatch):
    from chayuan.server.file_service.adapters import vg as mod
    from chayuan.server.file_service.adapters.vg import VgBgmAdapter
    monkeypatch.setattr(mod.binaries, "get_bgm_dir", lambda: None)
    monkeypatch.setattr(mod, "song_dir", lambda: "/nonexistent")
    with pytest.raises(FileRequestError) as ei:
        VgBgmAdapter().handle({"name": "x.mp3"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404

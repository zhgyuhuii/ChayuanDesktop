import pytest
from chayuan.server.file_service.base import FileRequestError


def test_artifact_missing_name_raises():
    from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
    with pytest.raises(FileRequestError) as ei:
        ArtifactAdapter().handle({}, {"id": "u"}, download=False)
    assert ei.value.status_code == 400


def test_artifact_not_found_raises(monkeypatch):
    from chayuan.server.file_service.adapters import artifact as mod
    from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
    monkeypatch.setattr(mod, "find_by_filename", lambda n: None)
    monkeypatch.setattr(mod, "fetch_from_storage", lambda n: None)
    with pytest.raises(FileRequestError) as ei:
        ArtifactAdapter().handle({"name": "deadbeef.png"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404


def test_artifact_returns_fileresponse(monkeypatch, tmp_path):
    from chayuan.server.file_service.adapters import artifact as mod
    from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
    p = tmp_path / "deadbeef.png"
    p.write_bytes(b"PNG")
    monkeypatch.setattr(mod, "find_by_filename", lambda n: p)
    resp = ArtifactAdapter().handle({"name": "deadbeef.png"}, {"id": "u"}, download=True)
    from fastapi.responses import FileResponse
    assert isinstance(resp, FileResponse)
    assert "attachment" in resp.headers.get("content-disposition", "")

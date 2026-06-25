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


def test_image_delegates_to_serve(monkeypatch):
    from chayuan.server.file_service.adapters import image as mod
    from chayuan.server.file_service.adapters.image import ImageAdapter
    seen = {}
    def _fake_serve(source_id, image_id, *, download, user):
        seen.update(source_id=source_id, image_id=image_id, download=download)
        return "IMG_RESP"
    monkeypatch.setattr(mod, "serve_image_file", _fake_serve)
    out = ImageAdapter().handle(
        {"source_id": "12", "image_id": "abc"}, {"id": "u"}, download=True)
    assert out == "IMG_RESP"
    assert seen == {"source_id": 12, "image_id": "abc", "download": True}


def test_image_missing_params_raises():
    from chayuan.server.file_service.base import FileRequestError
    from chayuan.server.file_service.adapters.image import ImageAdapter
    import pytest
    with pytest.raises(FileRequestError) as ei:
        ImageAdapter().handle({"source_id": "x", "image_id": ""}, {"id": "u"}, download=False)
    assert ei.value.status_code == 400

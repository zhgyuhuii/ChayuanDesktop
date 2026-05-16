"""POST /modality/ocr 和 /modality/transcribe 通用端点。"""
from __future__ import annotations

import io
import pytest


@pytest.mark.asyncio
async def test_ocr_endpoint_happy(monkeypatch):
    from chayuan.server.api_server import modality_routes as mr
    from chayuan.server.image_source.ocr_client import OCRResult

    async def _fake_run_ocr(data, *, port, timeout=30.0):
        assert data == b"\x89PNG..."
        return OCRResult(text="hello", lang="en", confidence=0.95,
                         box_count=1, elapsed_ms=10)
    monkeypatch.setattr(mr, "run_ocr", _fake_run_ocr)
    monkeypatch.setattr(mr, "resolve_ocr_port", lambda: 18380)

    class _UF:
        async def read(self): return b"\x89PNG..."
    resp = await mr.ocr_endpoint(file=_UF(), user={"id": 1, "role": "admin"})
    assert resp["code"] == 0
    assert resp["data"]["text"] == "hello"
    assert resp["data"]["lang"] == "en"


@pytest.mark.asyncio
async def test_ocr_endpoint_sidecar_unavail(monkeypatch):
    from chayuan.server.api_server import modality_routes as mr
    from fastapi import HTTPException
    monkeypatch.setattr(mr, "resolve_ocr_port", lambda: None)

    class _UF:
        async def read(self): return b"x"
    with pytest.raises(HTTPException) as exc:
        await mr.ocr_endpoint(file=_UF(), user={"id": 1, "role": "admin"})
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_transcribe_endpoint_happy(monkeypatch):
    from chayuan.server.api_server import modality_routes as mr

    captured = {}
    class _FakePipe:
        def transcribe(self, audio, *, language=None, **kw):
            captured["audio_size"] = len(audio.read())
            captured["language"] = language
            return "你好世界"
    monkeypatch.setattr(mr, "_get_audio_pipeline", lambda: _FakePipe())

    class _UF:
        async def read(self): return b"webm-bytes"
    resp = await mr.transcribe_endpoint(
        file=_UF(), language="zh", user={"id": 1, "role": "admin"},
    )
    assert resp["code"] == 0
    assert resp["data"]["text"] == "你好世界"
    assert resp["data"]["language"] == "zh"


@pytest.mark.asyncio
async def test_transcribe_endpoint_empty_returns_empty_text(monkeypatch):
    from chayuan.server.api_server import modality_routes as mr
    class _FakePipe:
        def transcribe(self, audio, *, language=None, **kw): return ""
    monkeypatch.setattr(mr, "_get_audio_pipeline", lambda: _FakePipe())

    class _UF:
        async def read(self): return b""
    resp = await mr.transcribe_endpoint(
        file=_UF(), language="", user={"id": 1, "role": "admin"},
    )
    assert resp["code"] == 0
    assert resp["data"]["text"] == ""

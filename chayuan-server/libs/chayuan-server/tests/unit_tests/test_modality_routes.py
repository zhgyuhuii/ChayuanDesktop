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
        filename = "test.png"
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
        filename = "x.png"
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
            # 新版传 path string,不是 BytesIO;读 path 字节算大小
            with open(audio, "rb") as f:
                captured["audio_size"] = len(f.read())
            captured["audio_path"] = audio
            captured["language"] = language
            return "你好世界"
    monkeypatch.setattr(mr, "_get_audio_pipeline", lambda: _FakePipe())

    class _UF:
        content_type = "audio/webm;codecs=opus"
        filename = "chunk-0.webm"
        async def read(self): return b"webm-bytes"
    resp = await mr.transcribe_endpoint(
        file=_UF(), language="zh", user={"id": 1, "role": "admin"},
    )
    assert resp["code"] == 0
    assert resp["data"]["text"] == "你好世界"
    assert resp["data"]["language"] == "zh"
    assert resp["data"]["audio_format"] == ".webm"
    assert resp["data"]["audio_bytes"] == len(b"webm-bytes")
    # tmp 文件后缀必须是 .webm,whisper 才能 sniff 出格式
    assert captured["audio_path"].endswith(".webm")


def test_guess_audio_ext():
    from chayuan.server.api_server.modality_routes import _guess_audio_ext
    assert _guess_audio_ext("audio/webm;codecs=opus", "x") == ".webm"
    assert _guess_audio_ext("audio/wav", "x") == ".wav"
    assert _guess_audio_ext("audio/mp3", "x") == ".mp3"
    assert _guess_audio_ext("audio/ogg", "x") == ".ogg"
    assert _guess_audio_ext("", "voice.m4a") == ".m4a"
    assert _guess_audio_ext("", "") == ".webm"  # MediaRecorder 默认


@pytest.mark.asyncio
async def test_transcribe_endpoint_empty_returns_empty_text(monkeypatch):
    from chayuan.server.api_server import modality_routes as mr
    class _FakePipe:
        def transcribe(self, audio, *, language=None, **kw): return ""
    monkeypatch.setattr(mr, "_get_audio_pipeline", lambda: _FakePipe())

    class _UF:
        filename = ""
        async def read(self): return b""
    resp = await mr.transcribe_endpoint(
        file=_UF(), language="", user={"id": 1, "role": "admin"},
    )
    assert resp["code"] == 0
    assert resp["data"]["text"] == ""


@pytest.mark.asyncio
async def test_call_log_endpoint_records_asr(monkeypatch):
    """transcribe_endpoint 应在 call_log("asr") 里 push 一条记录,GET endpoint 能读回。"""
    from chayuan.server.api_server import modality_routes as mr
    from chayuan.server.modality import call_log
    call_log.clear("asr")

    class _FakePipe:
        def transcribe(self, audio, *, language=None, **kw): return "你好"
    monkeypatch.setattr(mr, "_get_audio_pipeline", lambda: _FakePipe())

    class _UF:
        content_type = "audio/webm"
        filename = "test.webm"
        async def read(self): return b"webm-data"

    await mr.transcribe_endpoint(file=_UF(), language="zh",
                                  user={"id": 1, "role": "admin"})

    resp = await mr.call_log_endpoint(key="asr", limit=10,
                                       user={"id": 1, "role": "admin"})
    assert resp["code"] == 0
    entries = resp["data"]["entries"]
    assert len(entries) == 1
    assert entries[0]["success"] is True
    assert entries[0]["preview"] == "你好"
    assert entries[0]["bytes_in"] == len(b"webm-data")
    # extra 字段透传(filename/language 这种)
    assert entries[0].get("language") == "zh"

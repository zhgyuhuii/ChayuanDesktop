"""ModalityService HTTP 路由（T10）。

暴露三端口：
- ``POST /modality/asr``           上传音频 → 文本
- ``POST /modality/tts``           文本 → 音频 bytes
- ``POST /modality/video/understand`` 视频 URL → {asr, frames, summary}

扩展端点（Multimodal UX M0）：
- ``POST /modality/ocr``           图片 → OCR 文字（复用 image_source.ocr_client）
- ``POST /modality/transcribe``    音频 → ASR 文字（复用 modality.audio.AudioPipeline）
"""
from __future__ import annotations

import asyncio
import io
import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.modality import get_modality_service
from chayuan.server.image_source.ocr_client import resolve_port as resolve_ocr_port
from chayuan.server.image_source.ocr_client import run_ocr
from chayuan.server.image_source.pipeline import _OCR_SEMAPHORE

logger = logging.getLogger("chayuan.api.modality")

modality_router = APIRouter(prefix="/modality", tags=["Modality"])


@modality_router.post("/asr", summary="音频转文本（Whisper / faster-whisper / OpenAI）")
async def asr_endpoint(
    audio: UploadFile = File(..., description="音频文件；mp3 / wav / m4a 均可"),
    language: Optional[str] = Form(None, description="提示语言；如 zh / en；留空自动检测"),
    model: str = Form("base", description="Whisper 模型大小：tiny/base/small/medium/large"),
    user=Depends(require_auth_enabled()),
):
    data = await audio.read()
    svc = get_modality_service()
    text = svc.asr(data, language=language, model=model)
    return {"code": 0, "data": {"text": text, "length": len(text)}}


@modality_router.post("/tts", summary="文本转音频（edge-tts / OpenAI）")
async def tts_endpoint(
    text: str = Body(..., embed=True),
    voice: str = Body("zh-CN-XiaoxiaoNeural"),
    fmt: str = Body("mp3"),
    user=Depends(require_auth_enabled()),
):
    svc = get_modality_service()
    audio = svc.tts(text, voice=voice, fmt=fmt)
    if not audio:
        return {"code": 1, "msg": "TTS 未产出音频；请检查 edge-tts / OpenAI 可用性"}
    media = {"mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg"}.get(fmt, "application/octet-stream")
    return Response(content=audio, media_type=media)


@modality_router.post("/video/understand", summary="视频理解：抽帧 + ASR + Vision")
async def video_understand_endpoint(
    video_url: str = Body(..., embed=True, description="本地路径或 http(s) URL"),
    query: str = Body("", description="针对视频的提问（可选）"),
    every_sec: int = Body(8),
    max_frames: int = Body(16),
    model: Optional[str] = Body(None),
    user=Depends(require_auth_enabled()),
):
    svc = get_modality_service()
    out = svc.understand_video(video_url, query=query,
                                every_sec=int(every_sec), max_frames=int(max_frames),
                                vision_model=model)
    return {"code": 0, "data": out}


# ──────────────────────────────────────────────────────────────────────────────
# Multimodal UX M0: /ocr + /transcribe 通用端点
# ──────────────────────────────────────────────────────────────────────────────

_ASR_SEMAPHORE = asyncio.Semaphore(2)
_AUDIO_PIPE = None


def _get_audio_pipeline():
    """单例 AudioPipeline；monkeypatch seam。"""
    global _AUDIO_PIPE
    if _AUDIO_PIPE is None:
        from chayuan.server.modality.audio import AudioPipeline
        _AUDIO_PIPE = AudioPipeline()
    return _AUDIO_PIPE


@modality_router.post("/ocr", summary="对一张图做 OCR 并返回文字")
async def ocr_endpoint(
    file: UploadFile = File(...),
    user=Depends(require_auth_enabled()),
):
    """POST multipart 'file' (image)。

    Resp: {code: 0, data: {text, lang, confidence, box_count, elapsed_ms}}
    503 if OCR sidecar 未就绪；502 if 转写异常。
    """
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    port = resolve_ocr_port()
    if not port:
        raise HTTPException(503, "OCR sidecar not ready")
    async with _OCR_SEMAPHORE:
        result = await run_ocr(data, port=port)
    if result.error:
        raise HTTPException(502, f"OCR failed: {result.error}")
    return {
        "code": 0,
        "data": {
            "text": result.text,
            "lang": result.lang,
            "confidence": result.confidence,
            "box_count": result.box_count,
            "elapsed_ms": result.elapsed_ms,
        },
    }


@modality_router.post("/transcribe", summary="对一段音频做 ASR 转写")
async def transcribe_endpoint(
    file: UploadFile = File(...),
    language: str = Form(""),
    user=Depends(require_auth_enabled()),
):
    """POST multipart 'file' (audio: webm/opus/wav/mp3/ogg)。

    Form fields:
        - file: audio 字节
        - language: 语言提示（"zh"/"en"/""为自动）

    Resp: {code: 0, data: {text, language}}
    永不抛 ASR exception；失败时 text 为 "" + 顶层 code 仍 0。
    """
    data = await file.read()
    if not data:
        return {"code": 0, "data": {"text": "", "language": language or "auto"}}
    pipe = _get_audio_pipeline()
    async with _ASR_SEMAPHORE:
        try:
            text = await asyncio.to_thread(
                pipe.transcribe, io.BytesIO(data),
                language=(language or None),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("transcribe failed: %r", e)
            text = ""
    return {"code": 0, "data": {"text": text or "", "language": language or "auto"}}

"""ModalityService HTTP 路由（T10）。

暴露三端口：
- ``POST /modality/asr``           上传音频 → 文本
- ``POST /modality/tts``           文本 → 音频 bytes
- ``POST /modality/video/understand`` 视频 URL → {asr, frames, summary}
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, UploadFile
from fastapi.responses import Response

from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.modality import get_modality_service

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

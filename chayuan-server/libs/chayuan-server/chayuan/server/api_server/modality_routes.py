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


def _guess_audio_ext(content_type: str, filename: str) -> str:
    """根据 mime 或 filename 推断音频文件后缀。

    whisper-server / faster-whisper 都依赖文件后缀(或 magic bytes)识别格式;
    AudioPipeline._materialize 默认存为 input.audio(无扩展名)→ 无法解码。
    本函数保证下游拿到 .webm / .wav / .mp3 等正确后缀。
    """
    ct = (content_type or "").lower()
    if "webm" in ct:
        return ".webm"
    if "ogg" in ct or "opus" in ct:
        return ".ogg"
    if "wav" in ct:
        return ".wav"
    if "mp3" in ct or "mpeg" in ct:
        return ".mp3"
    if "mp4" in ct or "m4a" in ct or "aac" in ct:
        return ".m4a"
    if "flac" in ct:
        return ".flac"
    lower = (filename or "").lower()
    for ext in (".webm", ".ogg", ".wav", ".mp3", ".m4a", ".flac", ".opus"):
        if lower.endswith(ext):
            return ext
    return ".webm"  # 浏览器 MediaRecorder 默认


@modality_router.get("/asr/diag", summary="ASR 4 层后端实时可用性诊断")
async def asr_diag_endpoint(user=Depends(require_auth_enabled())):
    """对 sidecar / faster-whisper / openai-whisper / OpenAI API 各跑一次实时探测。

    专治"前端显示 ASR 已就绪、实际录音无文字"— sidecar 假 ready / Python 没装 /
    云端没配,全部能在这里看清楚。返回结构稳定,前端 onFinal=0 时自动调。
    """
    import httpx  # type: ignore

    # 1) 本地 sidecar — registry status + 实时 HTTP probe(不信缓存)
    sidecar = {
        "state": "unknown",
        "endpoint": "",
        "reachable": False,
        "http_status": 0,
        "last_error": "",
        "probe_error": "",
    }
    try:
        from chayuan.server.model_registry.local_runtime_registry import get_registry
        mgr = get_registry().get("asr")
        sidecar["state"] = mgr.status.state
        sidecar["endpoint"] = mgr.status.endpoint or ""
        sidecar["last_error"] = mgr.status.last_error or ""
        if sidecar["endpoint"]:
            try:
                async with httpx.AsyncClient(timeout=2.0) as c:
                    r = await c.get(sidecar["endpoint"].rstrip("/") + "/")
                    sidecar["http_status"] = r.status_code
                    sidecar["reachable"] = 200 <= r.status_code < 500
            except Exception as e:  # noqa: BLE001
                sidecar["probe_error"] = f"{type(e).__name__}: {e}"
    except Exception as e:  # noqa: BLE001
        sidecar["probe_error"] = f"registry: {e}"

    # 2) Python: faster-whisper
    def _imp(name: str) -> dict:
        try:
            __import__(name)
            return {"installed": True, "error": ""}
        except Exception as e:  # noqa: BLE001
            return {"installed": False, "error": str(e)}

    faster_whisper = _imp("faster_whisper")
    openai_whisper = _imp("whisper")

    # 3) OpenAI API
    openai_api = {"configured": False, "error": ""}
    try:
        from chayuan.server.utils import get_OpenAI
        client = get_OpenAI()
        openai_api["configured"] = client is not None
    except Exception as e:  # noqa: BLE001
        openai_api["error"] = str(e)

    # 4) 默认模型
    try:
        from chayuan.server.capability_router import resolve_model
        default_model = resolve_model("asr") or "(未配置)"
    except Exception:  # noqa: BLE001
        default_model = "(未配置)"

    # 5) 推荐
    if sidecar["reachable"]:
        recommend = "ASR sidecar 实时可达,语音应能工作。如仍无文字,看后端 transcribe 日志。"
    elif sidecar["state"] == "ready" and not sidecar["reachable"]:
        recommend = (
            f"⚠ ASR sidecar 显示 ready @ {sidecar['endpoint']} 但实时不可达 "
            f"(probe: {sidecar['probe_error'] or 'http ' + str(sidecar['http_status'])})。"
            f"进程可能已死,请到「设置 → AI 平台 → 本地服务」停止并重新启动 ASR。"
        )
    elif faster_whisper["installed"] or openai_whisper["installed"]:
        recommend = "Python whisper 后端可用,但你的请求可能没触达 — 检查后端 transcribe 日志。"
    elif openai_api["configured"]:
        recommend = "OpenAI API 已配,可作云端 fallback;否则建议本地启 sidecar 或 pip install faster-whisper。"
    else:
        recommend = (
            "所有 ASR 后端都不可用,任选其一启用:\n"
            "1) 设置 → AI 平台 → 本地服务,启动 ASR sidecar(whisper-server)\n"
            "2) pip install faster-whisper(轻量、CPU 友好)\n"
            "3) pip install openai-whisper\n"
            "4) 配置 OpenAI API key(云端)"
        )

    return {
        "code": 0,
        "data": {
            "sidecar": sidecar,
            "faster_whisper": faster_whisper,
            "openai_whisper": openai_whisper,
            "openai_api": openai_api,
            "default_model": default_model,
            "recommend": recommend,
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
        - language: 语言提示("zh"/"en"/""为自动)

    Resp: {code: 0, data: {text, language, audio_format, audio_bytes}}
    永不抛 ASR exception;失败时 text 为 "" + 顶层 code 仍 0。
    """
    data = await file.read()
    if not data:
        return {"code": 0, "data": {"text": "", "language": language or "auto",
                                     "audio_format": "", "audio_bytes": 0}}
    # 写到带正确扩展名的 temp file,让 AudioPipeline 下游能 sniff 出格式
    import os as _os
    import tempfile as _tempfile
    ext = _guess_audio_ext(file.content_type or "", file.filename or "")
    audio_bytes = len(data)
    logger.info(
        "transcribe in: %d bytes, ct=%s, fn=%s → ext=%s, lang=%s",
        audio_bytes, file.content_type, file.filename, ext, language or "auto",
    )
    pipe = _get_audio_pipeline()
    tmp_path: Optional[str] = None
    text = ""
    async with _ASR_SEMAPHORE:
        try:
            with _tempfile.NamedTemporaryFile(suffix=ext, delete=False,
                                                prefix="chayuan_asr_") as tf:
                tf.write(data)
                tmp_path = tf.name
            text = await asyncio.to_thread(
                pipe.transcribe, tmp_path,
                language=(language or None),
            )
            logger.info("transcribe out: %d chars", len(text or ""))
        except Exception as e:  # noqa: BLE001
            logger.warning("transcribe failed: %r", e)
            text = ""
        finally:
            if tmp_path:
                try:
                    _os.unlink(tmp_path)
                except Exception:  # noqa: BLE001
                    pass
    return {
        "code": 0,
        "data": {
            "text": text or "",
            "language": language or "auto",
            "audio_format": ext,
            "audio_bytes": audio_bytes,
        },
    }

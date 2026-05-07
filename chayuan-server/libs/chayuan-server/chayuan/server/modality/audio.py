"""音频：ASR（Whisper / faster-whisper / OpenAI）+ TTS（Edge-TTS / OpenAI）。

所有依赖都是**运行时可选**：
- ASR 本地首选 ``faster-whisper``；未装则尝试 ``openai-whisper``；再不行降级到 OpenAI API
- TTS 本地首选 ``edge-tts``（免费、无 GPU）；云端走 OpenAI ``/audio/speech``

返回值全部是 bytes / str，方便在 dispatcher 里直接塞进 Streaming / Base64 响应。
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional, Tuple

logger = logging.getLogger("chayuan.modality.audio")


class AudioPipeline:
    """ASR + TTS 两个入口，都 fail-soft。"""

    # ---- 通用：把各种源标准化为本地路径 ---------------------------------

    @staticmethod
    def _materialize(audio: Any) -> Tuple[str, Optional[tempfile.TemporaryDirectory]]:
        """接受 bytes / BytesIO / 本地路径 / http(s) URL；返回 (path, cleanup)。"""
        # bytes / BytesIO
        if isinstance(audio, (bytes, bytearray)):
            td = tempfile.TemporaryDirectory(prefix="chayuan_asr_")
            p = Path(td.name) / "input.audio"
            p.write_bytes(bytes(audio))
            return str(p), td
        if isinstance(audio, io.BytesIO):
            td = tempfile.TemporaryDirectory(prefix="chayuan_asr_")
            p = Path(td.name) / "input.audio"
            p.write_bytes(audio.getvalue())
            return str(p), td
        if isinstance(audio, str):
            if audio.startswith(("http://", "https://")):
                import urllib.request
                td = tempfile.TemporaryDirectory(prefix="chayuan_asr_")
                p = Path(td.name) / "input.audio"
                with urllib.request.urlopen(audio, timeout=30) as r:
                    p.write_bytes(r.read())
                return str(p), td
            if os.path.exists(audio):
                return audio, None
        raise ValueError(f"unsupported audio type: {type(audio).__name__}")

    # ==================================================================
    # ASR
    # ==================================================================

    def transcribe(self, audio: Any, *, language: Optional[str] = None,
                    model: Optional[str] = None) -> str:
        """Whisper 风格转录。失败返回空字符串。

        ``model`` 不传 → 走 capability_router("asr") 拿用户在 UI 配的默认 ASR 模型;
        若 router 也未配,fallback "base"(faster-whisper 默认)。
        """
        if not model:
            try:
                from chayuan.server.capability_router import resolve_model
                model = resolve_model("asr") or "base"
            except Exception:  # noqa: BLE001
                model = "base"
        try:
            path, cleanup = self._materialize(audio)
        except Exception as e:  # noqa: BLE001
            logger.warning("materialize audio 失败：%r", e)
            return ""
        try:
            # 1) faster-whisper（首选，速度 3-5x）
            try:
                from faster_whisper import WhisperModel  # type: ignore
                m = WhisperModel(
                    model, device="cpu", compute_type="int8",
                )
                segments, _info = m.transcribe(
                    path, language=language, beam_size=1,
                )
                return "".join(seg.text for seg in segments).strip()
            except Exception as e:  # noqa: BLE001
                logger.debug("faster-whisper 不可用：%r", e)
            # 2) openai-whisper（CPU/GPU 皆可）
            try:
                import whisper  # type: ignore
                m = whisper.load_model(model)
                out = m.transcribe(path, language=language)
                return (out.get("text") or "").strip()
            except Exception as e:  # noqa: BLE001
                logger.debug("openai-whisper 不可用：%r", e)
            # 3) OpenAI API（云端）
            try:
                from chayuan.server.utils import get_OpenAI
                client = get_OpenAI()
                with open(path, "rb") as f:
                    resp = client.audio.transcriptions.create(
                        file=f, model="whisper-1", language=language or None,
                    )
                return (getattr(resp, "text", None) or "").strip()
            except Exception as e:  # noqa: BLE001
                logger.warning("OpenAI ASR 失败：%r", e)
            return ""
        finally:
            if cleanup is not None:
                try:
                    cleanup.cleanup()
                except Exception:  # noqa: BLE001
                    pass

    # ==================================================================
    # TTS
    # ==================================================================

    def synthesize(self, text: str, *, voice: Optional[str] = None,
                    fmt: str = "mp3") -> bytes:
        """文本 → 音频 bytes。失败返回空 bytes。

        ``voice`` 不传 → 走 capability_router("tts");router 也无配置时 fallback
        "zh-CN-XiaoxiaoNeural"(edge-tts 默认中文女声)。
        """
        if not voice:
            try:
                from chayuan.server.capability_router import resolve_model
                voice = resolve_model("tts") or "zh-CN-XiaoxiaoNeural"
            except Exception:  # noqa: BLE001
                voice = "zh-CN-XiaoxiaoNeural"
        if not text:
            return b""
        # 1) edge-tts（本地 / 免费）
        try:
            import asyncio
            import edge_tts  # type: ignore
            async def _run() -> bytes:
                communicate = edge_tts.Communicate(text=text, voice=voice)
                buf = bytearray()
                async for chunk in communicate.stream():
                    if chunk.get("type") == "audio":
                        buf.extend(chunk["data"])
                return bytes(buf)
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # 已在 loop 内（路由中）：用 asyncio.run_coroutine_threadsafe 简单阻塞回本线程
                    import concurrent.futures
                    fut = asyncio.run_coroutine_threadsafe(_run(), loop)
                    return fut.result(timeout=30)
                return asyncio.run(_run())
            except RuntimeError:
                return asyncio.run(_run())
        except Exception as e:  # noqa: BLE001
            logger.debug("edge-tts 不可用：%r", e)
        # 2) OpenAI TTS
        try:
            from chayuan.server.utils import get_OpenAI
            client = get_OpenAI()
            resp = client.audio.speech.create(
                model="tts-1", voice="alloy", input=text, response_format=fmt,
            )
            # resp 支持 .content / iter_bytes
            data = getattr(resp, "content", None)
            if isinstance(data, (bytes, bytearray)):
                return bytes(data)
            if hasattr(resp, "iter_bytes"):
                return b"".join(resp.iter_bytes())
        except Exception as e:  # noqa: BLE001
            logger.warning("OpenAI TTS 失败：%r", e)
        return b""

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

        Plan 3C 起 fallback 顺序:
          1) 本地 sidecar (whisper-server, /runtime/llama/asr/inference)
          2) faster-whisper (Python in-process)
          3) openai-whisper (Python in-process)
          4) OpenAI API
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

        # Plan 3C: 1) 本地 sidecar 优先
        try:
            text = self._transcribe_via_sidecar(path, language=language)
            if text:
                if cleanup is not None:
                    try:
                        cleanup.cleanup()
                    except Exception:  # noqa: BLE001
                        pass
                return text
        except Exception as e:  # noqa: BLE001
            logger.info("[asr] sidecar 不可用,fallback Python:%r", e)

        try:
            # 2) faster-whisper（首选，速度 3-5x）
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
            # 3) openai-whisper（CPU/GPU 皆可）
            try:
                import whisper  # type: ignore
                m = whisper.load_model(model)
                out = m.transcribe(path, language=language)
                return (out.get("text") or "").strip()
            except Exception as e:  # noqa: BLE001
                logger.debug("openai-whisper 不可用：%r", e)
            # 4) OpenAI API（云端）
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

    def _transcribe_via_sidecar(self, audio_path: str, *, language: Optional[str] = None) -> str:
        """Plan 3C: 走本地 whisper-server。

        步骤:
          1. 取 registry.get('asr') 当前 status
          2. 若 state != 'ready',触发 await start() (最多 30s)
          3. POST http://127.0.0.1:<port>/inference (multipart, file)
          4. 返 JSON text 字段
        sidecar 不可用任何环节抛 Exception,上层 fallback Python。
        """
        import asyncio
        import httpx  # type: ignore

        try:
            from chayuan.server.model_registry.local_runtime_registry import get_registry
            mgr = get_registry().get("asr")
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"asr registry 取 manager 失败:{e}") from e

        # 确保 ready
        if mgr.status.state != "ready":
            loop = asyncio.new_event_loop()
            try:
                status = loop.run_until_complete(asyncio.wait_for(mgr.start(), timeout=30))
            finally:
                loop.close()
            if status.state != "ready":
                raise RuntimeError(
                    f"asr sidecar start 失败 state={status.state} last_error={status.last_error}"
                )

        endpoint = mgr.status.endpoint or ""
        if not endpoint:
            raise RuntimeError("asr sidecar endpoint 空")

        url = f"{endpoint.rstrip('/')}/inference"
        data = {}
        if language:
            data["language"] = language
        with open(audio_path, "rb") as f:
            files = {"file": (Path(audio_path).name, f, "application/octet-stream")}
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(url, data=data, files=files)
                resp.raise_for_status()
                payload = resp.json()
                return (payload.get("text") or "").strip()

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

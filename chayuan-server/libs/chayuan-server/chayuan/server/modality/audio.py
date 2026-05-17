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


def _safe_cleanup(cleanup) -> None:
    """tempfile.TemporaryDirectory cleanup,失败静默(测试用例传 None 跳过)。"""
    if cleanup is None:
        return
    try:
        cleanup.cleanup()
    except Exception:  # noqa: BLE001
        pass

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
        """旧 API,只回 text(向后兼容)。新代码用 transcribe_with_diag。"""
        text, _diag = self.transcribe_with_diag(
            audio, language=language, model=model,
        )
        return text

    def transcribe_with_diag(
        self, audio: Any, *,
        language: Optional[str] = None, model: Optional[str] = None,
    ) -> Tuple[str, list]:
        """Whisper 风格转录,顺带回每一层的具体失败原因。失败返回 ("", diagnostics)。

        ``model`` 不传 → 走 capability_router("asr");router 未配 → "base"。

        Plan 3C 起 fallback 顺序:
          1) 本地 sidecar (whisper-server, /inference)
          2) faster-whisper (Python in-process)
          3) openai-whisper (Python in-process)
          4) OpenAI API

        diagnostics 元素形如 "[sidecar] HTTP 200 returned empty text (1234B in)";
        modality_routes.transcribe_endpoint 把它写到 call_log 的 error 字段,
        用户在"调用日志"面板能直接看到每层挂在哪。
        """
        diag: list[str] = []

        if not model:
            try:
                from chayuan.server.capability_router import resolve_model
                model = resolve_model("asr") or "base"
            except Exception as e:  # noqa: BLE001
                diag.append(f"[router] resolve_model('asr') 异常:{e};fallback model='base'")
                model = "base"
        try:
            path, cleanup = self._materialize(audio)
        except Exception as e:  # noqa: BLE001
            logger.warning("materialize audio 失败：%r", e)
            diag.append(f"[materialize] {type(e).__name__}: {e}")
            return "", diag

        # 1) 本地 sidecar 优先
        try:
            text, sidecar_diag = self._transcribe_via_sidecar_with_diag(
                path, language=language,
            )
            diag.extend(sidecar_diag)
            if text:
                _safe_cleanup(cleanup)
                return text, diag
        except Exception as e:  # noqa: BLE001
            logger.info("[asr] sidecar 不可用,fallback Python:%r", e)
            diag.append(f"[sidecar] exception: {type(e).__name__}: {e}")

        try:
            # 2) faster-whisper(首选,速度 3-5x)
            try:
                from faster_whisper import WhisperModel  # type: ignore
                m = WhisperModel(model, device="cpu", compute_type="int8")
                segments, _info = m.transcribe(
                    path, language=language, beam_size=1,
                )
                out = "".join(seg.text for seg in segments).strip()
                if out:
                    return out, diag
                diag.append(f"[faster-whisper] returned empty text (model={model})")
            except Exception as e:  # noqa: BLE001
                logger.debug("faster-whisper 不可用：%r", e)
                diag.append(f"[faster-whisper] {type(e).__name__}: {e}")
            # 3) openai-whisper(CPU/GPU 皆可)
            try:
                import whisper  # type: ignore
                m = whisper.load_model(model)
                out_obj = m.transcribe(path, language=language)
                out = (out_obj.get("text") or "").strip()
                if out:
                    return out, diag
                diag.append(f"[openai-whisper] returned empty text (model={model})")
            except Exception as e:  # noqa: BLE001
                logger.debug("openai-whisper 不可用：%r", e)
                diag.append(f"[openai-whisper] {type(e).__name__}: {e}")
            # 4) OpenAI API(云端)
            try:
                from chayuan.server.utils import get_OpenAI
                client = get_OpenAI()
                with open(path, "rb") as f:
                    resp = client.audio.transcriptions.create(
                        file=f, model="whisper-1", language=language or None,
                    )
                out = (getattr(resp, "text", None) or "").strip()
                if out:
                    return out, diag
                diag.append("[openai-api] returned empty text")
            except Exception as e:  # noqa: BLE001
                logger.warning("OpenAI ASR 失败：%r", e)
                diag.append(f"[openai-api] {type(e).__name__}: {e}")
            return "", diag
        finally:
            _safe_cleanup(cleanup)

    def _transcribe_via_sidecar(self, audio_path: str, *, language: Optional[str] = None) -> str:
        """旧 API,只回 text。新代码用 _transcribe_via_sidecar_with_diag。"""
        text, _diag = self._transcribe_via_sidecar_with_diag(
            audio_path, language=language,
        )
        return text

    def _transcribe_via_sidecar_with_diag(
        self, audio_path: str, *, language: Optional[str] = None,
    ) -> Tuple[str, list]:
        """Plan 3C: 走本地 whisper-server。

        步骤:
          1. 取 registry.get('asr') 当前 status
          2. 若 state != 'ready',触发 await start() (最多 30s)
          3. POST http://127.0.0.1:<port>/inference (multipart, file)
          4. 返 JSON text 字段
        sidecar 不可用任何环节抛 Exception,上层 fallback Python。

        除返 text 外,collect 详细诊断:HTTP 状态码 / 响应字节数 / body 预览 /
        异常类型,方便用户在"调用日志"面板看到 sidecar 实际返回。
        """
        import asyncio
        import httpx  # type: ignore

        diag: list[str] = []
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

        file_size = os.path.getsize(audio_path)
        file_name = Path(audio_path).name
        logger.info(
            "[asr] sidecar POST %s file=%s size=%dB lang=%s",
            url, file_name, file_size, language or "auto",
        )
        with open(audio_path, "rb") as f:
            files = {"file": (file_name, f, "application/octet-stream")}
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(url, data=data, files=files)
        body_preview = (resp.text or "")[:300]
        if resp.status_code != 200:
            diag.append(
                f"[sidecar] POST {url} → HTTP {resp.status_code}, "
                f"body={body_preview!r} (in={file_size}B file={file_name})"
            )
            raise RuntimeError(
                f"sidecar HTTP {resp.status_code}: {body_preview[:150]}"
            )
        try:
            payload = resp.json()
        except Exception as e:  # noqa: BLE001
            diag.append(
                f"[sidecar] POST {url} → 200 but invalid JSON: {body_preview!r} ({e})"
            )
            return "", diag
        text = (payload.get("text") or "").strip()
        if not text:
            # 这是当前用户场景:sidecar 通、HTTP 200、但 text 为空。
            # 通常是 whisper.cpp 的 ffmpeg/SDL build 不支持 webm/opus 容器,
            # 或音频太短/全静音。把详细信息留到 call_log 给用户诊断。
            diag.append(
                f"[sidecar] HTTP 200 但 text 为空 — 常见原因:whisper.cpp 不解码 "
                f"webm/opus(需在前端转 wav 或装 faster-whisper);"
                f"或音频过短/全静音 (in={file_size}B file={file_name} "
                f"resp={body_preview!r})"
            )
            return "", diag
        logger.info("[asr] sidecar text len=%d preview=%r", len(text), text[:80])
        return text, diag

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

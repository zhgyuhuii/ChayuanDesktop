"""本地引擎 TTS 连接器(对话「语音合成」模式)。

伪模型 ``local-tts:<engine>``(engine ∈ piper/edge/sherpa/clone)路由到这里,
复用 video_generation.steps.tts.synthesize 出音频,落 artifact 后 emit file part。
不依赖任何上游厂商凭证。
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from typing import AsyncIterator, Dict

from chayuan.server.modality.router.artifacts import save_bytes
from chayuan.server.modality.router.connectors.base import Connector, register
from chayuan.server.modality.router.protocol import Capability, GenerateReq
from chayuan.server.modality.router.sse_v5 import (
    data_part, error_event, file_part, text_delta, text_end, text_start,
)

logger = logging.getLogger("chayuan.modality.router")

_VALID = {"piper", "edge", "sherpa", "clone"}


def _engine_of(model: str) -> str:
    eng = (model or "").split(":", 1)[1].lower().strip() if ":" in (model or "") else "piper"
    return eng if eng in _VALID else "piper"


def _to_float(v, default: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@register(Capability.TTS, "local")
class LocalTTSConnector(Connector):
    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        text = (req.prompt or "").strip()
        if not text:
            yield error_event("TTS 需要输入要朗读的文本", code="empty_text")
            return
        engine = _engine_of(req.model)
        p = req.params or {}
        voice_name = (p.get("voice_name") or None)
        rate = _to_float(p.get("voice_rate", 1.0), 1.0)
        volume = _to_float(p.get("voice_volume", 1.0), 1.0)

        tid = "t0"
        yield text_start(tid)
        yield text_delta(tid, f"本地合成中(引擎={engine}, 音色={voice_name or '默认'})…")
        yield text_end(tid)
        yield data_part("task-progress", {"percent": 10, "message": "提交本地合成"})

        # 延迟 import:tts 模块依赖较重,放调用点
        from chayuan.server.video_generation.steps.tts import synthesize

        tmp = os.path.join(
            tempfile.gettempdir(),
            f"modality_tts_{os.getpid()}_{abs(hash(text)) % 1000000}.wav",
        )
        try:
            # synthesize 是阻塞调用(本地 TTS worker 锁 + 管道 poll，最长可达
            # 180s)。这里是 async generator，跑在主 API 进程的 **事件循环** 上
            # (modality TaskManager 的后台 asyncio.Task)。直接同步调用会把整个
            # 事件循环卡住 —— 期间所有其它请求(知识库对话、视频画幅/分辨率配置
            # 拉取等)全部 hang，表现为「主服务挂了」。必须丢到线程池跑，事件循环
            # 才不被独占。dev 下 worker 热、阻塞短不明显;打包后冷启/重试导致长
            # 时间阻塞,问题才暴露。
            result = await asyncio.to_thread(
                synthesize,
                text, tmp, voice_provider=engine, voice_name=voice_name,
                voice_rate=rate, voice_volume=volume,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[modality.local-tts] synthesize 异常: %r", e)
            yield error_event(f"本地 TTS 失败:{e}", code="local_tts_error")
            return
        if not result or not os.path.isfile(result.audio_file):
            yield error_event("本地 TTS 未产出音频(请确认本地引擎模型已就绪)", code="empty_audio")
            return

        yield data_part("task-progress", {"percent": 90, "message": "保存音频"})
        try:
            with open(result.audio_file, "rb") as fh:
                audio = fh.read()
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        saved = save_bytes(audio, "audio/wav", ext="wav")
        yield file_part(
            media_type="audio/wav",
            url=saved["url"],
            metadata={
                "sha256": saved["sha256"],
                "size_bytes": saved["size"],
                "engine": engine,
                "voice": voice_name,
                "rate": rate,
                "volume": volume,
                "duration_ms": result.duration_ms,
                "text_chars": len(text),
                "model": req.model,
            },
        )
        yield data_part(
            "usage",
            {"audio_chars": len(text), "engine": engine, "model": req.model, "size_bytes": saved["size"]},
        )
        yield data_part("task-progress", {"percent": 100, "message": "完成"})

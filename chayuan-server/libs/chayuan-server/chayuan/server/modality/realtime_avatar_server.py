"""实时数字人 WebRTC 服务(内置)—— aiortc peer + 队列驱动音视频 track + 编排骨架。

调用:python -m chayuan.server.modality.realtime_avatar_server --host 127.0.0.1 --port 18880
需 GPU + aiortc + MuseTalk。

架构:
  浏览器 --SDP--> /offer --> 每连接建一个 AvatarSession
  AvatarSession 持有 frame_queue / audio_queue
  QueuedVideoTrack.recv() 从 frame_queue 取 MuseTalk 帧(空则 idle 黑帧)
  QueuedAudioTrack.recv() 从 audio_queue 取 TTS 音频(空则静音)
  datachannel 收文字 -> session.orchestrate(text):
      _llm_answer(text)  [VERIFY 经主服务 chat]
      -> 逐句 _tts(sentence) [经主服务 /modality/tts,真]
      -> _musetalk_frames(avatar, wav) [GPU-VERIFY 占位:产 idle 帧]
      -> 帧入 frame_queue / 音频入 audio_queue

[GPU-VERIFY] 真实时媒体(MuseTalk 连续帧 + 音视频对齐 + 真 LLM/TTS 链路)
只能在用户 GPU+aiortc 环境验;本骨架 MuseTalk 段产 idle 帧,LLM/TTS 经 httpx
打主服务(127.0.0.1:62581),失败则降级(回显文字 / 静音)。
"""
from __future__ import annotations

import asyncio
import fractions
import logging
import re
from typing import Any, Dict, List, Optional

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app,
    parse_serve_args,
    serve,
)

logger = logging.getLogger("chayuan.modality.realtime_avatar_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "musetalk_repo": "",
    "avatar_path": "",          # 数字人形象图(MuseTalk 驱动底图)
    "fps": 25,
    "width": 512,
    "height": 512,
    "main_server": "http://127.0.0.1:62581",  # 主服务(LLM/TTS 源)
    "tts_voice": "zh-CN-XiaoxiaoNeural",
    "sample_rate": 48000,
}

_PCS: set = set()
_SENTENCE_SPLIT = re.compile(r"[。！？!?；;\n]")


class AvatarSession:
    """一路 WebRTC 连接的会话:队列 + 文字->LLM->TTS->MuseTalk 编排。
    纯 asyncio,无重依赖(aiortc/av/numpy/httpx 全在 track 工厂 / 方法内 lazy import)。"""

    def __init__(self, cfg: Dict[str, Any]) -> None:
        self.cfg = cfg
        self.fps = int(cfg.get("fps", 25))
        self.width = int(cfg.get("width", 512))
        self.height = int(cfg.get("height", 512))
        self.avatar_path = cfg.get("avatar_path", "") or ""
        self.main_server = str(cfg.get("main_server", "http://127.0.0.1:62581")).rstrip("/")
        self.tts_voice = cfg.get("tts_voice", "zh-CN-XiaoxiaoNeural")
        # 帧队列存 numpy ndarray(HxWx3 rgb);音频队列存 PCM bytes(int16 mono)
        self.frame_queue: "asyncio.Queue" = asyncio.Queue(maxsize=300)
        self.audio_queue: "asyncio.Queue" = asyncio.Queue(maxsize=300)

    # ── 编排 ────────────────────────────────────────────────────────────
    async def orchestrate(self, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        try:
            answer = await self._llm_answer(text)
            for sentence in self._split_sentences(answer):
                wav = await self._tts(sentence)
                await self._animate(sentence, wav)
        except Exception:  # noqa: BLE001
            logger.exception("[rt-avatar] orchestrate failed")

    @staticmethod
    def _split_sentences(text: str) -> List[str]:
        parts = [p.strip() for p in _SENTENCE_SPLIT.split(text or "")]
        return [p for p in parts if p]

    async def _llm_answer(self, text: str) -> str:
        """[VERIFY] 经主服务 chat 取回答。失败降级回显输入。
        主服务 chat 是 SSE,这里走非流式兜底:失败就回显 text。"""
        try:
            import httpx  # type: ignore
            async with httpx.AsyncClient(timeout=60) as client:
                # [VERIFY] 真实 chat 端点/协议以主服务为准;此处 best-effort
                r = await client.post(
                    f"{self.main_server}/api/v1/kb-query/answer",
                    json={"query": text, "mode": "llm"},
                )
                if r.status_code == 200:
                    data = r.json()
                    ans = (data.get("answer") or data.get("data", {}).get("answer") or "").strip()
                    if ans:
                        return ans
        except Exception:  # noqa: BLE001
            logger.warning("[rt-avatar] LLM 取答失败,降级回显", exc_info=True)
        return text

    async def _tts(self, sentence: str) -> bytes:
        """经主服务 /modality/tts 合成。失败返 b''(animate 段产静音)。"""
        try:
            import httpx  # type: ignore
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    f"{self.main_server}/modality/tts",
                    json={"text": sentence, "voice": self.tts_voice, "fmt": "wav"},
                )
                if r.status_code == 200 and r.content:
                    return r.content
        except Exception:  # noqa: BLE001
            logger.warning("[rt-avatar] TTS 失败,降级静音", exc_info=True)
        return b""

    async def _animate(self, sentence: str, wav: bytes) -> None:
        """[GPU-VERIFY] MuseTalk:形象图 + wav -> 口型帧序列,与音频对齐入队。
        本骨架:产 idle 黑帧(按句子时长估帧数),音频 PCM 入 audio_queue。
        真实现替换 _musetalk_frames + 真 wav->PCM 解码。"""
        import numpy as np  # type: ignore

        # 音频:wav bytes -> PCM int16 入队(best-effort 解析 wav header)
        pcm = self._wav_to_pcm(wav)
        if pcm:
            await self.audio_queue.put(pcm)

        # 帧:[GPU-VERIFY] 这里应调 MuseTalk(self.avatar_path, wav)->帧序列。
        # 骨架按估算时长产 idle 帧占位(让 video track 有东西可拉,验证管线连通)。
        n_frames = max(1, int(self.fps * self._estimate_seconds(sentence)))
        for _ in range(n_frames):
            frame = np.zeros((self.height, self.width, 3), dtype="uint8")
            try:
                self.frame_queue.put_nowait(frame)
            except asyncio.QueueFull:
                break

    @staticmethod
    def _estimate_seconds(sentence: str) -> float:
        # 粗估:中文约 5 字/秒
        return max(0.4, len(sentence) / 5.0)

    @staticmethod
    def _wav_to_pcm(wav: bytes) -> Optional[bytes]:
        """[VERIFY] wav bytes -> int16 mono PCM。best-effort 用 wave 解析。"""
        if not wav:
            return None
        try:
            import io
            import wave
            with wave.open(io.BytesIO(wav), "rb") as w:
                return w.readframes(w.getnframes())
        except Exception:  # noqa: BLE001
            return None


def _make_video_track(session: "AvatarSession"):
    """QueuedVideoTrack:从 session.frame_queue 拉帧,空则 idle 黑帧。"""
    from aiortc import VideoStreamTrack  # type: ignore
    import av  # type: ignore
    import numpy as np  # type: ignore

    fps = session.fps
    w, h = session.width, session.height

    class _QueuedVideo(VideoStreamTrack):
        async def recv(self):
            pts, _ = await self.next_timestamp()
            try:
                arr = session.frame_queue.get_nowait()
            except asyncio.QueueEmpty:
                arr = np.zeros((h, w, 3), dtype="uint8")
            frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
            frame.pts = pts
            frame.time_base = fractions.Fraction(1, fps)
            return frame

    return _QueuedVideo()


def _make_audio_track(session: "AvatarSession"):
    """QueuedAudioTrack:从 session.audio_queue 拉 PCM,空则静音。
    [GPU-VERIFY] 采样率/帧长与 MuseTalk/TTS 对齐需用户环境调。"""
    from aiortc import AudioStreamTrack  # type: ignore
    import av  # type: ignore
    import numpy as np  # type: ignore

    sample_rate = int(session.cfg.get("sample_rate", 48000))
    samples_per_frame = sample_rate // 100  # 10ms 帧

    class _QueuedAudio(AudioStreamTrack):
        def __init__(self) -> None:
            super().__init__()
            self._buf = b""

        async def recv(self):
            pts, _ = await self.next_timestamp()
            need = samples_per_frame * 2  # int16 = 2 bytes
            while len(self._buf) < need:
                try:
                    self._buf += session.audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            if len(self._buf) >= need:
                chunk = self._buf[:need]
                self._buf = self._buf[need:]
            else:
                chunk = b"\x00" * need  # 静音
            arr = np.frombuffer(chunk, dtype="int16").reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(arr, format="s16", layout="mono")
            frame.sample_rate = sample_rate
            frame.pts = pts
            frame.time_base = fractions.Fraction(1, sample_rate)
            return frame

    return _QueuedAudio()


def _register_routes(app: Any, cfg: Dict[str, Any]) -> None:
    from fastapi import HTTPException, Request

    @app.post("/offer")
    async def offer(request: Request) -> Dict[str, Any]:
        try:
            from aiortc import RTCPeerConnection, RTCSessionDescription  # type: ignore
        except ImportError as e:
            app.state.lib_error = "aiortc 未安装,请装实时数字人运行时"
            raise HTTPException(status_code=503, detail=app.state.lib_error) from e

        payload = await request.json()
        sdp = payload.get("sdp")
        typ = payload.get("type")
        if not (sdp and typ):
            raise HTTPException(status_code=400, detail="sdp/type 必填")

        session = AvatarSession(cfg)
        pc = RTCPeerConnection()
        _PCS.add(pc)

        @pc.on("connectionstatechange")
        async def _on_state() -> None:
            if pc.connectionState in ("failed", "closed"):
                await pc.close()
                _PCS.discard(pc)

        @pc.on("datachannel")
        def _on_dc(channel) -> None:
            @channel.on("message")
            def _on_msg(message) -> None:
                app.state.lib_loaded = True
                # 文字 -> 异步编排(LLM->TTS->MuseTalk),驱动 track 队列
                asyncio.ensure_future(session.orchestrate(
                    message if isinstance(message, str) else str(message)
                ))

        pc.addTrack(_make_video_track(session))
        pc.addTrack(_make_audio_track(session))
        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=typ))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}


def main() -> None:
    args = parse_serve_args(default_port=18880)
    app = make_runtime_app(
        framework="realtime_avatar",
        title="Realtime Avatar Runtime",
        default_config=_DEFAULT_CONFIG,
        register_routes=_register_routes,
    )

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await asyncio.gather(*[pc.close() for pc in list(_PCS)], return_exceptions=True)
        _PCS.clear()

    serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()

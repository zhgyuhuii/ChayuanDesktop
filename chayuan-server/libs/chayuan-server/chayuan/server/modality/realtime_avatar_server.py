"""实时数字人 WebRTC 服务(内置)—— aiortc peer + MuseTalk 实时口型帧 + TTS 音频。

调用:python -m chayuan.server.modality.realtime_avatar_server --host 127.0.0.1 --port 18880
需 GPU + aiortc + MuseTalk。
[GPU-VERIFY] 自定义 track 的 recv() 真产帧(MuseTalk 连续帧 / TTS 音频)、
text->LLM->TTS->MuseTalk 实时编排,均待用户 GPU 环境接;本骨架 recv() 返 idle 黑帧/静音。
"""
from __future__ import annotations

import asyncio
import fractions
import logging
from typing import Any, Dict

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app,
    parse_serve_args,
    serve,
)

logger = logging.getLogger("chayuan.modality.realtime_avatar_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "musetalk_repo": "",
    "fps": 25,
    "width": 512,
    "height": 512,
}

_PCS: set = set()


def _make_idle_video_track(cfg: Dict[str, Any]):
    """返回 aiortc VideoStreamTrack:recv() 给 idle 黑帧。
    [GPU-VERIFY] 真实现把 MuseTalk 连续帧塞进来(按 fps + 跟 TTS 音频对齐)。"""
    from aiortc import VideoStreamTrack  # type: ignore
    import av  # type: ignore
    import numpy as np  # type: ignore

    w = int(cfg.get("width", 512))
    h = int(cfg.get("height", 512))
    fps = int(cfg.get("fps", 25))

    class _IdleVideo(VideoStreamTrack):
        async def recv(self):
            pts, time_base = await self.next_timestamp()
            frame_arr = np.zeros((h, w, 3), dtype="uint8")
            frame = av.VideoFrame.from_ndarray(frame_arr, format="rgb24")
            frame.pts = pts
            frame.time_base = fractions.Fraction(1, fps)
            return frame

    return _IdleVideo()


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
                # [GPU-VERIFY] 收到文字 -> LLM->TTS->MuseTalk 编排,驱动 video/audio track
                app.state.lib_loaded = True
                logger.info("[rt-avatar] 收到文字(待接编排): %r", message)

        pc.addTrack(_make_idle_video_track(cfg))
        # [GPU-VERIFY] pc.addTrack(<TTS 音频 track>)
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

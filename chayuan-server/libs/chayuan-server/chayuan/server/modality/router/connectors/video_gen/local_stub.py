"""本地开源视频模型 vendor 的占位桩(P4 填实现)。

P1 只建立扩展点契约:注册 (T2V, "local"),调用时返回明确的"未安装"错误,
而不是 404 或静默失败。P4 将用 GPU sidecar(LTX-Video / Wan2.2-5B,
ComfyUI/diffusers)实现真正的本地出片,届时替换本文件的 generate/resume。
"""
from __future__ import annotations

from typing import AsyncIterator, Dict

from chayuan.server.modality.router.connectors.base import Connector, register
from chayuan.server.modality.router.protocol import Capability, GenerateReq
from chayuan.server.modality.router.sse_v5 import error_event


@register(Capability.T2V, "local")
class LocalVideoConnector(Connector):
    """本地视频模型连接器占位。P4 实现 submit=入本地队列 / poll=查本地任务 / result=本地文件。"""

    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        yield error_event(
            "本地视频模型运行时尚未安装(计划于 P4 提供)。请先使用云端视频模型(如百炼 Wanx)。",
            code="local_video_runtime_not_installed",
        )

"""生数科技 Vidu 文生/图生视频 Connector — Token 鉴权，异步轮询。

api_key 字段填 Vidu 平台颁发的 API Token（非 Bearer，前缀是 Token）。
有图片附件时自动走图生视频(I2V)，否则走文生视频(T2V)。

# TODO(P2b-verify): 以 Vidu platform.vidu.com 当前文档实测核对
#   - Authorization 头前缀是 "Token " 而非 "Bearer "（当前 Vidu Enterprise API 规范如此）
#   - endpoint 路径、body 字段名称、状态字符串枚举值
#   - I2V images 字段是否接受 data: URL，还是必须公网可达 HTTP/HTTPS URL
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

# TODO(P2b-verify): 确认 Vidu 官方 Enterprise API base URL
_DEFAULT_BASE = "https://api.vidu.com"

# Vidu 轮询状态字符串（参考文档；以实测为准）
# TODO(P2b-verify): 确认以下状态字符串是否与 platform.vidu.com 文档一致
_RUNNING_STATUSES = {"created", "queueing", "processing"}


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "vidu")
class ViduVideoConnector(AsyncPollVideoConnector):
    """生数科技 Vidu 文生/图生视频连接器（继承 AsyncPollVideoConnector 基类）。

    注意鉴权头格式（非标准）：``Authorization: Token {api_key}``，
    不是 Bearer，这是 Vidu Enterprise API 的要求。

    使用方：在模型平台配置中：
      - platform_type: vidu
      - api_key: <Vidu API Token>
      - api_base: https://api.vidu.com（可留空，用默认值）
      - model: vidu2.0 或其它 Vidu 视频模型

    # TODO(P2b-verify): 以 Vidu platform.vidu.com 当前文档实测核对(含 Token 鉴权前缀)
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 内部工具 ──

    def _base(self, req: GenerateReq) -> str:
        """提取并规范化 api_base，去除尾斜杠，空则用默认值。"""
        return (req.api_base or "").rstrip("/") or _DEFAULT_BASE

    def _auth_headers(self, req: GenerateReq) -> Dict[str, str]:
        """构造含 Vidu Token 的请求头。

        ⚠️ 鉴权前缀是 ``Token``，不是 ``Bearer``。
        # TODO(P2b-verify): 确认 Authorization 头前缀（Token vs Bearer）
        """
        return {
            "Authorization": f"Token {req.api_key}",
            "Content-Type": "application/json",
        }

    def _is_i2v(self, req: GenerateReq) -> bool:
        """判断是否图生视频：req.attachments 中有 image/* 附件。"""
        return any(
            (getattr(a, "mime", "") or "").startswith("image/")
            for a in (req.attachments or [])
        )

    # ── 4 个钩子 ──

    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """构造提交请求 (url, headers, body)。

        T2V: POST {base}/ent/v2/text2video
        I2V: POST {base}/ent/v2/img2video，body 含 images=[第一张图片URL]

        # TODO(P2b-verify): 以 Vidu 当前官方文档核对 endpoint 路径、body 字段名称
        # TODO(P2b-verify): 确认 I2V images 字段是数组（仅 1 张）还是单字段
        # TODO(P2b-verify): 确认 images 字段是否要求公网可达 URL（data: URL 可能不支持）
        # TODO(P2b-verify): 确认 duration/aspect_ratio/resolution 字段合法值范围
        """
        params = req.params or {}

        if self._is_i2v(req):
            url = f"{self._base(req)}/ent/v2/img2video"  # TODO(P2b-verify): endpoint 路径
        else:
            url = f"{self._base(req)}/ent/v2/text2video"  # TODO(P2b-verify): endpoint 路径

        body: Dict = {
            "model": req.model,
            "prompt": req.prompt,
        }

        # I2V：把第一个图片附件的 url 填入 images 数组（Vidu 只接受 1 张）
        if self._is_i2v(req):
            for a in req.attachments or []:
                if (getattr(a, "mime", "") or "").startswith("image/"):
                    # TODO(P2b-verify): images 需公网可达 URL;字段以 Vidu 文档实测核对
                    body["images"] = [a.url]
                    break

        # 透传可选参数（仅在 params 中明确提供时才放入 body）
        _optional_keys: List[str] = [
            "duration",
            "aspect_ratio",
            "resolution",
        ]
        for key in _optional_keys:
            val = params.get(key)
            if val is not None:
                body[key] = val  # TODO(P2b-verify): 各字段在 Vidu API 中的正式名称

        headers = self._auth_headers(req)
        return url, headers, body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应中解析 upstream task_id。

        Vidu 响应格式（参考）:
          {"task_id": "...", ...}

        # TODO(P2b-verify): 确认 task_id 字段是否在顶层，还是嵌套在 data 里
        """
        return (resp_json or {}).get("task_id") or ""  # TODO(P2b-verify)

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        Vidu 轮询端点（参考）:
          GET {base}/ent/v2/tasks/{task_id}/creations

        # TODO(P2b-verify): 确认轮询 endpoint 路径格式
        # TODO(P2b-verify): 确认轮询无需 body，只 GET + Token 头
        """
        url = f"{self._base(req)}/ent/v2/tasks/{task_id}/creations"  # TODO(P2b-verify)
        return url, self._auth_headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应解析为标准化 PollResult。

        Vidu 响应格式（参考）:
          {
            "state": "processing" | "success" | "failed" | "created" | "queueing",
            "creations": [{"url": "https://..."}]
          }

        状态映射:
          success                              → SUCCEEDED（取 creations[0].url）
          failed                               → FAILED
          created / queueing / processing      → RUNNING
          其它                                 → UNKNOWN

        # TODO(P2b-verify): 以 Vidu 当前官方文档核对状态字符串枚举值
        # TODO(P2b-verify): 确认 "success" 拼写（非 "succeeded"）
        # TODO(P2b-verify): 确认视频 URL 字段路径（creations[0].url）
        # TODO(P2b-verify): 确认失败时是否有 error_message/message 字段
        """
        data = resp_json or {}
        st = (data.get("state") or "").lower()  # TODO(P2b-verify): 状态字符串

        if st == "success":  # TODO(P2b-verify): Vidu 用 "success" 非 "succeeded"
            creations = data.get("creations") or []
            video_urls: List[str] = []
            if creations and isinstance(creations, list):
                first = creations[0]
                url = (first or {}).get("url") if isinstance(first, dict) else None
                if url:
                    video_urls = [url]
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=video_urls)

        if st == "failed":  # TODO(P2b-verify): 失败状态字符串
            error_msg = (
                data.get("error_message")
                or data.get("message")
                or "Vidu 视频生成失败"
            )  # TODO(P2b-verify): 失败时错误信息字段名
            return PollResult(status=PollStatus.FAILED, error_message=error_msg)

        if st in _RUNNING_STATUSES:  # TODO(P2b-verify): 进行中状态字符串集合
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)

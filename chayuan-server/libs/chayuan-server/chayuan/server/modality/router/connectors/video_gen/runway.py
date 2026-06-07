"""Runway 文生/图生视频 Connector — Bearer + X-Runway-Version 鉴权，异步轮询。

api_key 字段填 Runway API Key（Bearer token 鉴权）。
api_base 填 Runway 端点，空则用默认 https://api.dev.runwayml.com。
有图片附件时自动走图生视频(I2V: POST /v1/image_to_video)，
否则走文生视频(T2V: POST /v1/text_to_video)。

# TODO(P2b-verify): 以 Runway docs.dev.runwayml.com 当前文档实测核对
#   (endpoint/版本头/model/状态/output 路径);需海外网络。
#   - base URL 是否仍为 https://api.dev.runwayml.com 或已切至 https://api.runwayml.com
#   - X-Runway-Version: 2024-11-06 是否为最新版本头（必须字段）
#   - T2V endpoint 路径: /v1/text_to_video
#   - I2V endpoint 路径: /v1/image_to_video
#   - 提交响应 task id 字段: resp["id"]
#   - 轮询 endpoint: GET /v1/tasks/{task_id}
#   - 轮询状态枚举: PENDING / RUNNING / THROTTLED / SUCCEEDED / FAILED / CANCELED
#   - 成功结果路径: resp["output"]（list of video URLs，取 output[0]）
#   - model id: gen4_turbo / gen3a_turbo 是否为当前正式 id
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

# Runway API 默认端点
# TODO(P2b-verify): 确认官方 base URL（当前已知: api.dev.runwayml.com）
_DEFAULT_BASE = "https://api.dev.runwayml.com"

# Runway API 版本头（必须随每个请求发送）
# TODO(P2b-verify): 确认当前最新 X-Runway-Version 值
_RUNWAY_VERSION = "2024-11-06"

# 进行中的状态字符串集合
# TODO(P2b-verify): 以 Runway 文档核对状态枚举（PENDING / RUNNING / THROTTLED 等）
_RUNNING_STATUSES = {"PENDING", "RUNNING", "THROTTLED"}

# 终止失败态
# TODO(P2b-verify): 确认 FAILED / CANCELED 拼写及是否完整
_FAILED_STATUSES = {"FAILED", "CANCELED"}


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "runway")
class RunwayVideoConnector(AsyncPollVideoConnector):
    """Runway 文生/图生视频连接器（继承 AsyncPollVideoConnector 基类）。

    使用方：在模型平台配置中：
      - platform_type: runway
      - api_key: <Runway API Key>（Bearer token）
      - api_base: https://api.dev.runwayml.com（可留空，用默认值）
      - model: gen4_turbo 或 gen3a_turbo 等

    T2V：POST {base}/v1/text_to_video，body 含 model + promptText。
    I2V：POST {base}/v1/image_to_video，body 含 model + promptText + promptImage（附件 URL）。

    鉴权：Authorization: Bearer {api_key} + X-Runway-Version: 2024-11-06。
    轮询：GET {base}/v1/tasks/{task_id} + 同样请求头。
    成功结果：resp["output"] 是 URL 列表，取 output[0]。

    # TODO(P2b-verify): 以 Runway docs.dev.runwayml.com 当前文档实测核对全部字段名/路径/状态串；需海外网络。
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 内部工具 ──

    def _base(self, req: GenerateReq) -> str:
        """提取并规范化 api_base，去除尾斜杠，空则用默认值。"""
        return (req.api_base or "").rstrip("/") or _DEFAULT_BASE

    def _headers(self, req: GenerateReq) -> Dict[str, str]:
        """构造含 Bearer token 和 X-Runway-Version 的请求头。

        # TODO(P2b-verify): 确认 X-Runway-Version 是否为必须字段及其最新值
        """
        return {
            "Authorization": f"Bearer {req.api_key}",
            "Content-Type": "application/json",
            "X-Runway-Version": _RUNWAY_VERSION,
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

        T2V: POST {base}/v1/text_to_video，body: {model, promptText}
        I2V: POST {base}/v1/image_to_video，body 额外含 promptImage=<第一个图片附件.url>

        可选参数从 req.params 透传（有才放）:
          ratio / duration

        # TODO(P2b-verify): 确认 T2V endpoint 路径（/v1/text_to_video）
        # TODO(P2b-verify): 确认 I2V endpoint 路径（/v1/image_to_video）
        # TODO(P2b-verify): 确认 promptText 字段名（非 prompt）
        # TODO(P2b-verify): 确认 promptImage 字段名及是否接受 URL 字符串
        # TODO(P2b-verify): 确认 ratio / duration 字段在 Runway API 的正式名称及合法值范围
        """
        params = req.params or {}
        is_i2v = self._is_i2v(req)

        # 根据 T2V / I2V 选择不同的 endpoint
        # TODO(P2b-verify): 核对 endpoint 路径
        if is_i2v:
            url = f"{self._base(req)}/v1/image_to_video"
        else:
            url = f"{self._base(req)}/v1/text_to_video"

        body: Dict = {
            "model": req.model,
            "promptText": req.prompt,  # TODO(P2b-verify): 字段名 promptText vs prompt
        }

        # I2V：把第一个图片附件的 url 填入 promptImage 字段
        if is_i2v:
            for a in req.attachments or []:
                if (getattr(a, "mime", "") or "").startswith("image/"):
                    body["promptImage"] = a.url  # TODO(P2b-verify): 字段名 promptImage vs imageUrl
                    break  # 仅取第一张图

        # 透传可选参数（仅在 params 中明确提供时才放入 body）
        # TODO(P2b-verify): 各字段在 Runway API 中的正式名称及合法值范围
        _optional_keys: List[str] = ["ratio", "duration"]
        for key in _optional_keys:
            val = params.get(key)
            if val is not None:
                body[key] = val

        return url, self._headers(req), body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应 JSON 中解析 upstream task_id。

        Runway 提交响应格式（参考）:
          {"id": "task-xxx", "status": "PENDING", ...}

        # TODO(P2b-verify): 确认 task id 字段名（id）及顶层层级（无嵌套 data 包裹）
        """
        return (resp_json or {}).get("id") or ""  # TODO(P2b-verify)

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        Runway 轮询端点（参考）:
          GET {base}/v1/tasks/{task_id}

        # TODO(P2b-verify): 确认轮询 endpoint 路径格式
        # TODO(P2b-verify): 确认轮询只需 GET + Bearer + X-Runway-Version 头，无需 body
        """
        url = f"{self._base(req)}/v1/tasks/{task_id}"  # TODO(P2b-verify)
        return url, self._headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应 JSON 解析为标准化 PollResult。

        Runway 轮询响应格式（参考）:
          {
            "id": "task-xxx",
            "status": "PENDING" | "RUNNING" | "THROTTLED" | "SUCCEEDED" | "FAILED" | "CANCELED",
            "output": ["https://..."],   -- SUCCEEDED 时包含视频 URL 列表
            "failure": "错误描述（失败时）"
          }

        状态映射:
          SUCCEEDED                       → SUCCEEDED（video_urls 从 output[0] 取，空安全）
          FAILED / CANCELED               → FAILED（错误信息从 failure 字段取）
          PENDING / RUNNING / THROTTLED   → RUNNING
          其它                            → UNKNOWN

        # TODO(P2b-verify): 以 Runway 文档核对状态字符串枚举值（大写 vs 小写）
        # TODO(P2b-verify): 确认成功时 output 路径（顶层 output 字段，list of URL）
        # TODO(P2b-verify): 确认失败时错误字段名（failure vs error vs message）
        """
        data = resp_json or {}
        # TODO(P2b-verify): 状态字符串大小写（当前假设为全大写 SUCCEEDED/FAILED/PENDING 等）
        st = (data.get("status") or "").upper()

        if st == "SUCCEEDED":  # TODO(P2b-verify): 状态字符串
            # output 是 URL 列表；空安全，取整个 list
            output = data.get("output") or []
            video_urls: List[str] = [u for u in output if u]
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=video_urls)

        if st in _FAILED_STATUSES:  # TODO(P2b-verify): 失败/取消状态字符串集合
            error_msg = (
                data.get("failure")  # TODO(P2b-verify): 错误信息字段名 failure vs error vs message
                or f"Runway 视频生成{st}"
            )
            return PollResult(status=PollStatus.FAILED, error_message=error_msg)

        if st in _RUNNING_STATUSES:  # TODO(P2b-verify): 进行中状态字符串集合
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)

"""智谱 CogVideoX 文生/图生视频 Connector — Bearer API Key 鉴权，异步轮询。

api_key 字段填智谱 open.bigmodel.cn 的 API Key（直接 Bearer 鉴权，无需拆分）。
有 image/* 附件时自动走图生视频(I2V)，否则走文生视频(T2V)。

使用方：在模型平台配置中：
  - platform_type: zhipu
  - api_key: <智谱 API Key>
  - api_base: https://open.bigmodel.cn/api/paas/v4（可留空，用默认值）
  - model: cogvideox-flash 或其它 CogVideoX 视频模型

# TODO(P2b-verify): 以智谱 open.bigmodel.cn 当前文档实测核对以下所有字段/端点/状态值
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

# TODO(P2b-verify): 确认智谱视频 API base URL（当前已知：https://open.bigmodel.cn/api/paas/v4）
_DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4"

# TODO(P2b-verify): 确认 CogVideoX 提交 endpoint 路径（当前已知：/videos/generations）
_SUBMIT_PATH = "/videos/generations"

# TODO(P2b-verify): 确认 CogVideoX 轮询 endpoint 路径（当前已知：/async-result/{task_id}）
_POLL_PATH_TPL = "/async-result/{task_id}"

# TODO(P2b-verify): 确认 CogVideoX 任务状态字符串枚举值（大小写）
_RUNNING_STATUSES = {"PROCESSING"}


# ──────────────────────────────────────────────────────────────
# 内部工具
# ──────────────────────────────────────────────────────────────


def _base(req: GenerateReq) -> str:
    """提取并规范化 api_base，去除尾斜杠，空则用默认值。"""
    return (req.api_base or "").rstrip("/") or _DEFAULT_BASE


def _auth_headers(req: GenerateReq) -> Dict[str, str]:
    """构造含 Bearer API Key 的请求头。

    智谱使用简单 Bearer 鉴权，api_key 直接作为 token。
    # TODO(P2b-verify): 确认鉴权头字段（Authorization: Bearer <key>）是否与当前文档一致
    """
    return {
        "Authorization": f"Bearer {req.api_key}",
        "Content-Type": "application/json",
    }


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "zhipu")
class ZhipuVideoConnector(AsyncPollVideoConnector):
    """智谱 CogVideoX 文生/图生视频连接器（继承 AsyncPollVideoConnector 基类）。

    鉴权方式：Authorization: Bearer {api_key}
    提交端点：POST {base}/videos/generations
    轮询端点：GET  {base}/async-result/{task_id}

    # TODO(P2b-verify): 以智谱 open.bigmodel.cn 当前文档实测核对全部字段/状态/端点
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 4 个钩子 ──

    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """构造提交请求 (url, headers, body)。

        T2V: POST {base}/videos/generations，body 含 model + prompt
        I2V: 同端点，body 额外含 image_url（图片附件 URL）

        可选透传参数（在 req.params 中显式提供时才放入 body）：
          size, duration, quality, fps, with_audio

        # TODO(P2b-verify): 确认 POST endpoint 路径 /videos/generations
        # TODO(P2b-verify): 确认 I2V 使用 image_url 字段（非 image）
        # TODO(P2b-verify): 确认 image_url 需公网可达 URL；本地 artifact URL 可能需转 base64 或上传至公网
        # TODO(P2b-verify-i2v): image_url 需公网可达 URL，本地 artifact 可能要转 base64/公网
        # TODO(P2b-verify): 确认 size 合法值（如 "1280x720"、"720x1280"、"1920x1080" 等）
        # TODO(P2b-verify): 确认 duration 单位（秒 or 毫秒）及合法值范围
        # TODO(P2b-verify): 确认 quality / fps / with_audio 字段名及类型
        """
        params = req.params or {}
        url = f"{_base(req)}{_SUBMIT_PATH}"  # TODO(P2b-verify): endpoint 路径
        headers = _auth_headers(req)

        body: Dict = {
            "model": req.model,
            "prompt": req.prompt,
        }

        # I2V：把第一个图片附件的 url 填入 image_url 字段
        # TODO(P2b-verify): 智谱 image_url 需公网可达 URL，本地 artifact 可能要转 base64/公网
        for att in req.attachments or []:
            if (getattr(att, "mime", "") or "").startswith("image/"):
                body["image_url"] = att.url  # TODO(P2b-verify): 字段名 image_url vs image
                break

        # 透传可选参数（仅在 params 中明确提供时才放入 body）
        _optional_keys: List[str] = [
            "size",
            "duration",
            "quality",
            "fps",
            "with_audio",
        ]
        for key in _optional_keys:
            val = params.get(key)
            if val is not None:
                body[key] = val  # TODO(P2b-verify): 各字段在智谱 API 中的正式名称和类型

        return url, headers, body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应中解析 upstream task_id。

        智谱 CogVideoX 响应格式（参考）:
          {"id": "...", "model": "cogvideox-flash", "task_status": "PROCESSING", ...}

        # TODO(P2b-verify): 确认 task_id 字段名为顶层 "id"（非 data.task_id）
        """
        return (resp_json or {}).get("id") or ""  # TODO(P2b-verify): 字段路径

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        智谱 CogVideoX 轮询端点（参考）:
          GET {base}/async-result/{task_id}

        # TODO(P2b-verify): 确认轮询 endpoint 路径 /async-result/{task_id}
        # TODO(P2b-verify): 确认轮询只需 GET + Bearer 头，无需 body
        """
        poll_path = _POLL_PATH_TPL.format(task_id=task_id)
        url = f"{_base(req)}{poll_path}"  # TODO(P2b-verify): endpoint 路径
        return url, _auth_headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应解析为标准化 PollResult。

        智谱 CogVideoX 响应格式（参考）:
          {
            "model": "cogvideox-flash",
            "task_status": "SUCCESS" | "FAIL" | "PROCESSING",
            "video_result": [
              {"url": "https://...", "cover_image_url": "https://..."}
            ],
            "error": {"code": "...", "message": "..."}   （失败时）
          }

        状态映射:
          SUCCESS     → SUCCEEDED（取 video_result[0].url）
          FAIL        → FAILED（错误信息取 error.message 或 error.code）
          PROCESSING  → RUNNING
          其它        → UNKNOWN

        # TODO(P2b-verify): 确认状态字符串大小写（SUCCESS/FAIL/PROCESSING）
        # TODO(P2b-verify): 确认视频 URL 路径（video_result[0].url）
        # TODO(P2b-verify): 确认失败时错误信息字段（error.message / error.code）
        # TODO(P2b-verify): 确认是否有 PENDING 状态（初始排队）
        """
        st = (resp_json or {}).get("task_status") or ""  # TODO(P2b-verify): 状态字段名

        if st == "SUCCESS":  # TODO(P2b-verify): 成功状态字符串
            video_result = (resp_json or {}).get("video_result") or []
            # 空安全：取第一个元素的 url，若不存在则 video_urls 为空列表
            video_urls: List[str] = []
            if video_result and isinstance(video_result, list):
                first = video_result[0] if video_result else {}
                first_url = (first or {}).get("url") or ""
                if first_url:
                    video_urls = [first_url]
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=video_urls)

        if st == "FAIL":  # TODO(P2b-verify): 失败状态字符串
            # 尽量从响应中取错误信息
            err_obj = (resp_json or {}).get("error") or {}
            error_msg = (
                (err_obj.get("message") or err_obj.get("code"))
                or "智谱视频生成失败"  # TODO(P2b-verify): error 字段结构
            )
            return PollResult(status=PollStatus.FAILED, error_message=error_msg)

        if st in _RUNNING_STATUSES:  # TODO(P2b-verify): 进行中状态字符串集合
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)

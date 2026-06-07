"""快手 Kling 可灵 文生/图生视频 Connector — JWT(ak/sk) 鉴权，异步轮询。

api_key 字段约定填 "<AccessKey>:<SecretKey>"（英文冒号分隔）。
有图片附件时自动走图生视频(I2V)，否则走文生视频(T2V)。

# TODO(P2-verify): endpoint / 字段 / 状态串以 KlingAI 当前官方文档实测核对。
"""

from __future__ import annotations

import time
from typing import Dict, List, Tuple

import jwt

from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

# TODO(P2-verify): 确认 KlingAI 官方 API base URL（当前已知：https://api.klingai.com）
_DEFAULT_BASE = "https://api.klingai.com"

# TODO(P2-verify): 确认 KlingAI 官方状态字符串（submitted/processing/pending/succeed/failed）
_RUNNING_STATUSES = {"submitted", "processing", "pending"}


# ──────────────────────────────────────────────────────────────
# JWT 鉴权工具（PyJWT 2.8，HS256）
# ──────────────────────────────────────────────────────────────


def _kling_jwt(ak: str, sk: str) -> str:
    """用 AccessKey/SecretKey 生成 KlingAI JWT token。

    payload: iss=ak, exp=now+1800, nbf=now-5
    算法: HS256，有效期 30 分钟，提前 5 秒生效（容时钟漂移）。
    """
    now = int(time.time())
    payload = {
        "iss": ak,
        "exp": now + 1800,
        "nbf": now - 5,
    }
    # PyJWT 2.x encode() 返回 str
    return jwt.encode(
        payload,
        sk,
        algorithm="HS256",
        headers={"alg": "HS256", "typ": "JWT"},
    )


def _split_keys(api_key: str) -> Tuple[str, str]:
    """从 "<AccessKey>:<SecretKey>" 格式拆出 (ak, sk)。

    如果 api_key 中无冒号，则整体当作 ak，sk 为空字符串。
    """
    key = api_key or ""
    if ":" in key:
        ak, sk = key.split(":", 1)
        return ak.strip(), sk.strip()
    return key.strip(), ""


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "kling")
class KlingVideoConnector(AsyncPollVideoConnector):
    """KlingAI 文生/图生视频连接器（继承 AsyncPollVideoConnector 基类）。

    使用方：在模型平台配置中：
      - platform_type: kling
      - api_key: <AccessKey>:<SecretKey>（英文冒号连接）
      - api_base: https://api.klingai.com（可留空，用默认值）
      - model: kling-v2-5-turbo 或其它 Kling 视频模型
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 内部工具 ──

    def _base(self, req: GenerateReq) -> str:
        """提取并规范化 api_base，去除尾斜杠，空则用默认值。"""
        return (req.api_base or "").rstrip("/") or _DEFAULT_BASE

    def _auth_headers(self, req: GenerateReq) -> Dict[str, str]:
        """构造含 JWT Bearer token 的请求头。"""
        ak, sk = _split_keys(req.api_key)
        token = _kling_jwt(ak, sk)
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _is_i2v(self, req: GenerateReq) -> bool:
        """判断是否图生视频：req.attachments 中有 image/* 附件。"""
        return any(
            (getattr(a, "mime", "") or "").startswith("image/")
            for a in (req.attachments or [])
        )

    def _video_kind(self, req: GenerateReq) -> str:
        """返回 'image2video' 或 'text2video'。"""
        return "image2video" if self._is_i2v(req) else "text2video"

    # ── 4 个钩子 ──

    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """构造提交请求 (url, headers, body)。

        T2V: POST {base}/v1/videos/text2video
        I2V: POST {base}/v1/videos/image2video，body 含 image=附件url

        # TODO(P2-verify): 以 KlingAI 当前官方文档核对 endpoint 路径、body 字段名称
        # TODO(P2-verify): 确认 I2V 是否用 image_url 字段而非 image
        # TODO(P2-verify): 确认 duration 单位（秒 or 毫秒）及合法值范围
        # TODO(P2-verify): 确认 aspect_ratio 合法值（"16:9"/"9:16"/"1:1" 等）
        # TODO(P2-verify): 确认 mode 字段含义（"std"/"pro" 等）
        """
        params = req.params or {}
        kind = self._video_kind(req)
        url = f"{self._base(req)}/v1/videos/{kind}"  # TODO(P2-verify): endpoint 路径

        body: Dict = {
            "model_name": req.model,
            "prompt": req.prompt,
        }

        # I2V：把第一个图片附件的 url 填入 image 字段
        if self._is_i2v(req):
            for a in req.attachments or []:
                if (getattr(a, "mime", "") or "").startswith("image/"):
                    body["image"] = a.url  # TODO(P2-verify): 字段名 image vs image_url
                    break

        # 透传可选参数（仅在 params 中明确提供时才放入 body）
        _optional_keys: List[str] = [
            "duration",
            "aspect_ratio",
            "mode",
            "negative_prompt",
        ]
        for key in _optional_keys:
            val = params.get(key)
            if val is not None:
                body[key] = val  # TODO(P2-verify): 各字段在 Kling API 中的正式名称

        headers = self._auth_headers(req)
        return url, headers, body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应中解析 upstream task_id。

        KlingAI 响应格式（参考）:
          {"code": 0, "message": "Success", "data": {"task_id": "...", ...}}

        # TODO(P2-verify): 确认 task_id 字段层级是否为 data.task_id
        """
        return ((resp_json or {}).get("data") or {}).get("task_id") or ""  # TODO(P2-verify)

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        KlingAI 轮询端点（参考）:
          GET {base}/v1/videos/{text2video|image2video}/{task_id}

        # TODO(P2-verify): 确认轮询 endpoint 是否需要区分 text2video vs image2video
        # TODO(P2-verify): 确认轮询无需 body，只 GET + JWT 头
        """
        kind = self._video_kind(req)
        url = f"{self._base(req)}/v1/videos/{kind}/{task_id}"  # TODO(P2-verify)
        return url, self._auth_headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应解析为标准化 PollResult。

        KlingAI 响应格式（参考）:
          {
            "code": 0,
            "data": {
              "task_id": "...",
              "task_status": "processing" | "succeed" | "failed" | "submitted" | "pending",
              "task_status_msg": "错误描述（失败时）",
              "task_result": {
                "videos": [{"id": "...", "url": "...", "duration": "5"}]
              }
            }
          }

        状态映射:
          succeed                           → SUCCEEDED（取 data.task_result.videos[].url）
          failed                            → FAILED（错误信息取 data.task_status_msg）
          submitted / processing / pending  → RUNNING
          其它                              → UNKNOWN

        # TODO(P2-verify): 以 KlingAI 当前官方文档核对状态字符串枚举值
        # TODO(P2-verify): 确认 succeed 拼写（非 succeeded）
        # TODO(P2-verify): 确认视频 URL 字段路径（task_result.videos[].url）
        # TODO(P2-verify): 确认失败时错误信息字段名（task_status_msg）
        """
        data = (resp_json or {}).get("data") or {}
        st = (data.get("task_status") or "").lower()  # TODO(P2-verify): 状态字符串

        if st == "succeed":  # TODO(P2-verify): KlingAI 用 "succeed" 非 "succeeded"
            task_result = data.get("task_result") or {}
            videos = task_result.get("videos") or []
            video_urls = [v.get("url") for v in videos if v.get("url")]
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=video_urls)

        if st == "failed":  # TODO(P2-verify): 失败状态字符串
            error_msg = data.get("task_status_msg") or "Kling 视频生成失败"  # TODO(P2-verify)
            return PollResult(status=PollStatus.FAILED, error_message=error_msg)

        if st in _RUNNING_STATUSES:  # TODO(P2-verify): 进行中状态字符串集合
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)

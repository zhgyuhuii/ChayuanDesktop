"""字节跳动 即梦 Seedance 文生/图生视频 Connector — 火山引擎 Ark 异步轮询。

api_key 字段填火山引擎 API Key（Bearer token 鉴权）。
api_base 填 Ark 端点，空则用默认 https://ark.cn-beijing.volces.com/api/v3。
有图片附件时自动走图生视频(I2V)，否则走文生视频(T2V)。

注册 vendor: volcengine（platform_type 在平台表里可能是 openai-compat，
但视频任务走 Ark 原生异步，故 connector 注册到 vendor "volcengine"）。

# TODO(P2b-verify): 以火山引擎 Ark 当前文档实测核对
#   - model id（seedance-1-lite / seedance-1-pro 等正式名称）
#   - 提交 endpoint 路径（/contents/generations/tasks 是否为最终路径）
#   - content 列表字段名及 role 取值（reference_image 是否正确）
#   - image_url.url 需公网可达（内网/localhost 地址会失败）
#   - 可选参数字段名：ratio / resolution / duration / generate_audio / watermark
#   - 轮询状态字符串枚举（queued / running / succeeded / failed / expired / cancelled）
#   - 成功结果路径（content.video_url 是 str 还是列表）
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

# 火山引擎 Ark 默认端点
# TODO(P2b-verify): 确认官方 base URL（当前已知：ark.cn-beijing.volces.com）
_DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3"

# 视频生成任务提交路径
# TODO(P2b-verify): 确认 /contents/generations/tasks 是否为正式端点路径
_SUBMIT_PATH = "/contents/generations/tasks"

# 任务轮询路径模板（末尾追加 task_id）
# TODO(P2b-verify): 确认轮询路径格式
_POLL_PATH_PREFIX = "/contents/generations/tasks/"

# 进行中的状态字符串集合
# TODO(P2b-verify): 以 Ark 文档核对状态枚举值（queued / running / pending 等）
_RUNNING_STATUSES = {"queued", "running", "pending"}

# 终止失败态
# TODO(P2b-verify): 确认 failed / expired / cancelled 拼写及是否完整
_FAILED_STATUSES = {"failed", "expired", "cancelled"}


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "volcengine")
class SeedanceVideoConnector(AsyncPollVideoConnector):
    """字节跳动 即梦 Seedance 文生/图生视频连接器（继承 AsyncPollVideoConnector 基类）。

    使用方：在模型平台配置中：
      - platform_type: volcengine（或 openai，取决于平台表注册方式）
      - api_key: <火山引擎 API Key>（Bearer token）
      - api_base: https://ark.cn-beijing.volces.com/api/v3（可留空，用默认值）
      - model: seedance-1-lite 或 seedance-1-pro 等

    I2V 判断：req.attachments 中有 image/* MIME 类型的附件时自动走图生视频，
    content 列表中追加 image_url 类型条目（role=reference_image）。

    # TODO(P2b-verify): 以火山引擎 Ark 当前文档实测核对全部字段名/路径/状态串。
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 内部工具 ──

    def _base(self, req: GenerateReq) -> str:
        """提取并规范化 api_base，去除尾斜杠，空则用默认值。"""
        return (req.api_base or "").rstrip("/") or _DEFAULT_BASE

    def _auth_headers(self, req: GenerateReq) -> Dict[str, str]:
        """构造含 Bearer token 的请求头。"""
        return {
            "Authorization": f"Bearer {req.api_key}",
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

        T2V: content 列表仅含 {"type": "text", "text": req.prompt}。
        I2V: content 列表额外追加图片条目（type=image_url，role=reference_image）。

        可选参数从 req.params 透传（有才放）:
          ratio / resolution / duration / generate_audio / watermark

        # TODO(P2b-verify): 确认 content 结构是否符合 Ark 最新文档
        # TODO(P2b-verify): image_url 需公网可达地址；字段名/role 取值以实测核对
        # TODO(P2b-verify): 确认 ratio / resolution / duration 等字段在 Ark API 的正式名称
        # TODO(P2b-verify): 确认 generate_audio / watermark 字段类型（bool vs str）
        """
        params = req.params or {}
        url = f"{self._base(req)}{_SUBMIT_PATH}"

        # 构造 content 列表
        content: List[Dict] = [{"type": "text", "text": req.prompt}]

        # I2V：把第一个图片附件追加为 image_url 条目
        if self._is_i2v(req):
            for a in req.attachments or []:
                if (getattr(a, "mime", "") or "").startswith("image/"):
                    # TODO(P2b-verify): role="reference_image" 是否为 Ark Seedance 正式字段
                    content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": a.url},
                            "role": "reference_image",
                        }
                    )
                    break  # 仅取第一张图

        body: Dict = {
            "model": req.model,
            "content": content,
        }

        # 透传可选参数（仅在 params 中明确提供时才放入 body）
        # TODO(P2b-verify): 各字段在 Ark Seedance API 中的正式名称及合法值范围
        _optional_keys: List[str] = [
            "ratio",
            "resolution",
            "duration",
            "generate_audio",
            "watermark",
        ]
        for key in _optional_keys:
            val = params.get(key)
            if val is not None:
                body[key] = val

        headers = self._auth_headers(req)
        return url, headers, body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应 JSON 中解析 upstream task_id。

        Ark Seedance 提交响应格式（参考）:
          {"id": "task-xxx", "status": "queued", ...}

        # TODO(P2b-verify): 确认 task id 字段名（id vs task_id）
        # TODO(P2b-verify): 确认顶层字段层级（无嵌套 data 包裹）
        """
        return (resp_json or {}).get("id") or ""  # TODO(P2b-verify)

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        Ark Seedance 轮询端点（参考）:
          GET {base}/contents/generations/tasks/{task_id}

        # TODO(P2b-verify): 确认轮询 endpoint 路径格式
        # TODO(P2b-verify): 确认轮询只需 GET + Bearer 头，无需 body
        """
        url = f"{self._base(req)}{_POLL_PATH_PREFIX}{task_id}"
        return url, self._auth_headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应 JSON 解析为标准化 PollResult。

        Ark Seedance 轮询响应格式（参考）:
          {
            "id": "task-xxx",
            "status": "queued" | "running" | "succeeded" | "failed" | "expired" | "cancelled",
            "content": {
              "video_url": "https://..."
            },
            "error": {"code": "...", "message": "..."}
          }

        状态映射:
          succeeded               → SUCCEEDED（video_url 从 content.video_url 取，空安全）
          failed / expired / cancelled → FAILED（错误信息从 error.message 或 status 取）
          queued / running        → RUNNING
          其它                    → UNKNOWN

        # TODO(P2b-verify): 以 Ark 文档核对状态字符串枚举值
        # TODO(P2b-verify): 确认成功时 video_url 路径（content.video_url 是 str）
        # TODO(P2b-verify): 确认失败时错误字段名（error.message vs message）
        """
        data = resp_json or {}
        st = (data.get("status") or "").lower()  # TODO(P2b-verify): 状态字符串

        if st == "succeeded":  # TODO(P2b-verify): Ark 用 "succeeded" 还是 "succeed"
            content = data.get("content") or {}
            # video_url 可能是 str，也可能不存在；空安全处理
            raw_url = content.get("video_url")  # TODO(P2b-verify): 字段名 video_url
            video_urls: List[str] = [raw_url] if raw_url else []
            return PollResult(
                status=PollStatus.SUCCEEDED,
                video_urls=video_urls,
                raw=data,
            )

        if st in _FAILED_STATUSES:  # TODO(P2b-verify): 失败/过期/取消状态字符串集合
            error_obj = data.get("error") or {}
            error_msg = (
                error_obj.get("message")
                or f"Seedance 视频生成{st}"
            )  # TODO(P2b-verify): 错误信息字段路径
            return PollResult(status=PollStatus.FAILED, error_message=error_msg)

        if st in _RUNNING_STATUSES:  # TODO(P2b-verify): 进行中状态字符串集合
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)

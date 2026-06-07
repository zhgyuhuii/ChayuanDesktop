"""MiniMax 海螺(Hailuo) 文生/图生视频 Connector — Bearer 鉴权,异步轮询。

轮询成功后上游只返回 file_id,需再调 /v1/files/retrieve 换真实下载 URL。
本 Connector override ``fetch_result_urls`` 实现这一二段式 URL 解析。

api_key 字段填 MiniMax API Key(Bearer token)。

# TODO(P2b-verify): 以 MiniMax api.minimaxi.com 当前文档实测核对
#   - 状态串大小写 (Success/Fail/Preparing/Queueing/Processing 首字母大写确认)
#   - file_id 是否两段式字段(如 file_id vs file.id vs 嵌套)
#   - files/retrieve 响应字段名 (file.download_url 路径确认)
#   - first_frame_image 接受公网 URL 还是 base64 data URL
#   - video_generation endpoint 路径及所有 body 字段名称
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import httpx

from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

logger = logging.getLogger("chayuan.modality.connectors.video_gen.minimax")

_DEFAULT_BASE = "https://api.minimaxi.com"

# MiniMax 轮询状态串(首字母大写,以官方文档为准)
# TODO(P2b-verify): 确认以下状态串枚举值大小写
_RUNNING_STATUSES = {"Preparing", "Queueing", "Processing"}


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "minimax")
class MiniMaxVideoConnector(AsyncPollVideoConnector):
    """MiniMax 海螺(Hailuo) 文生/图生视频连接器(继承 AsyncPollVideoConnector 基类)。

    使用方:在模型平台配置中:
      - platform_type: minimax
      - api_key: <MiniMax API Key>
      - api_base: https://api.minimaxi.com (可留空,用默认值)
      - model: video-01 或其它 MiniMax 视频模型

    特殊点:轮询 SUCCEEDED 时上游只返回 file_id,不直接给下载 URL。
    本 Connector override ``fetch_result_urls`` 多发一次 /v1/files/retrieve 请求
    换取真实 download_url,再交由基类下载视频字节。

    # TODO(P2b-verify): 以 MiniMax api.minimaxi.com 当前文档实测核对全部字段
    """

    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # ── 内部工具 ──

    def _base(self, req: GenerateReq) -> str:
        """提取并规范化 api_base,去除尾斜杠,空则用默认值。"""
        return (req.api_base or "").rstrip("/") or _DEFAULT_BASE

    def _auth_headers(self, req: GenerateReq) -> Dict[str, str]:
        """构造含 Bearer token 的请求头。"""
        return {
            "Authorization": f"Bearer {req.api_key}",
            "Content-Type": "application/json",
        }

    def _first_image_attachment(self, req: GenerateReq) -> Optional[str]:
        """返回第一个 image/* 附件的 URL,无则返回 None。"""
        for a in req.attachments or []:
            if (getattr(a, "mime", "") or "").startswith("image/"):
                return a.url
        return None

    # ── 4 个钩子 ──

    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """构造提交请求 (url, headers, body)。

        POST {base}/v1/video_generation
        body:
          - model: req.model
          - prompt: req.prompt
          - first_frame_image: 第一个 image/* 附件 url(I2V 时)
          - duration / resolution / prompt_optimizer: 从 req.params 透传(有才放)

        # TODO(P2b-verify): endpoint 路径 /v1/video_generation 以官方文档核对
        # TODO(P2b-verify): first_frame_image 接受公网 URL 或 base64 data URL
        # TODO(P2b-verify): duration/resolution/prompt_optimizer 字段名及合法值范围
        """
        url = f"{self._base(req)}/v1/video_generation"
        headers = self._auth_headers(req)

        body: Dict = {
            "model": req.model,
            "prompt": req.prompt,
        }

        # I2V: 有图片附件时注入 first_frame_image
        # TODO(P2b-verify): first_frame_image 接受公网 URL 或 base64 data URL
        img_url = self._first_image_attachment(req)
        if img_url:
            body["first_frame_image"] = img_url

        # 透传可选参数(仅在 params 中明确提供时才放入 body)
        _optional_keys = ["duration", "resolution", "prompt_optimizer"]
        params = req.params or {}
        for key in _optional_keys:
            val = params.get(key)
            if val is not None:
                body[key] = val  # TODO(P2b-verify): 各字段在 MiniMax API 中的正式名称

        return url, headers, body

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应中解析 upstream task_id。

        MiniMax 响应格式(参考):
          {"task_id": "...", "base_resp": {"status_code": 0, "status_msg": "success"}}

        # TODO(P2b-verify): task_id 字段层级确认(顶层 vs 嵌套 data.task_id)
        """
        return (resp_json or {}).get("task_id") or ""

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求 (url, headers)。

        GET {base}/v1/query/video_generation?task_id={task_id}

        # TODO(P2b-verify): endpoint /v1/query/video_generation 以官方文档核对
        # TODO(P2b-verify): task_id 参数名确认
        """
        url = f"{self._base(req)}/v1/query/video_generation?task_id={task_id}"
        headers = self._auth_headers(req)
        return url, headers

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应解析为标准化 PollResult。

        MiniMax 轮询响应格式(参考):
          {
            "status": "Processing" | "Success" | "Fail" | "Preparing" | "Queueing",
            "file_id": "...",        # 仅 Success 时存在
            "base_resp": {"status_code": 0, "status_msg": "success"}
          }

        状态映射:
          Success                          → SUCCEEDED (raw=resp_json,保留 file_id 供 fetch_result_urls)
          Fail                             → FAILED
          Preparing / Queueing / Processing → RUNNING
          其它                             → UNKNOWN

        注意:SUCCEEDED 时不直接填 video_urls,因为上游只给 file_id。
        把整个 resp_json 存入 pr.raw,由 fetch_result_urls override 再发一次
        /v1/files/retrieve 换取真实下载 URL。

        # TODO(P2b-verify): 状态串大小写(Success/Fail/Preparing/Queueing/Processing)
        # TODO(P2b-verify): file_id 字段名确认(顶层 file_id vs 嵌套)
        """
        st = (resp_json or {}).get("status") or ""

        if st == "Success":  # TODO(P2b-verify): 大小写
            # 不在此处填 video_urls,file_id 保存在 raw,由 fetch_result_urls 处理
            return PollResult(
                status=PollStatus.SUCCEEDED,
                raw=resp_json,
            )

        if st == "Fail":  # TODO(P2b-verify): 大小写
            base_resp = (resp_json or {}).get("base_resp") or {}
            err_msg = base_resp.get("status_msg") or "MiniMax 视频生成失败"
            return PollResult(status=PollStatus.FAILED, error_message=err_msg)

        if st in _RUNNING_STATUSES:
            return PollResult(status=PollStatus.RUNNING)

        return PollResult(status=PollStatus.UNKNOWN)

    # ── 二段式 URL 解析(override 基类默认行为) ──

    async def fetch_result_urls(
        self,
        client: httpx.AsyncClient,
        req: GenerateReq,
        pr: PollResult,
    ) -> List[str]:
        """从轮询结果的 file_id 调 /v1/files/retrieve 换取真实下载 URL。

        基类默认返回 pr.video_urls(空列表),本方法 override 之:
        1. 从 pr.raw 取 file_id
        2. GET {base}/v1/files/retrieve?file_id={file_id} + Bearer 头
        3. 解析响应的 file.download_url 并返回

        空安全:任一环节取不到值都返回 []。

        # TODO(P2b-verify): /v1/files/retrieve endpoint 路径以官方文档核对
        # TODO(P2b-verify): file_id 字段名(pr.raw 里的 key)
        # TODO(P2b-verify): 响应中 download_url 路径(file.download_url vs 顶层 download_url)
        """
        raw = pr.raw or {}
        file_id = raw.get("file_id") or ""  # TODO(P2b-verify): file_id 字段名
        if not file_id:
            logger.warning(
                "[minimax] fetch_result_urls: no file_id in poll raw response: %r", raw
            )
            return []

        base = self._base(req)
        retrieve_url = f"{base}/v1/files/retrieve?file_id={file_id}"
        headers = {
            "Authorization": f"Bearer {req.api_key}",
        }

        try:
            resp = await client.get(retrieve_url, headers=headers)
            resp.raise_for_status()
            resp_json = resp.json()
        except Exception as e:  # noqa: BLE001
            logger.error(
                "[minimax] fetch_result_urls: files/retrieve failed file_id=%s: %r",
                file_id, e,
            )
            return []

        # TODO(P2b-verify): 响应字段路径 file.download_url
        file_obj = resp_json.get("file") or {}
        download_url = file_obj.get("download_url") or ""
        if not download_url:
            logger.warning(
                "[minimax] fetch_result_urls: no download_url in retrieve resp: %r",
                resp_json,
            )
            return []

        return [download_url]

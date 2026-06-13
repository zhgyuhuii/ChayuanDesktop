"""阿里百炼(DashScope)文生视频 Connector — wanx 异步轮询模式。

上游协议(异步任务)
====================

1. 提交任务(含 ``X-DashScope-Async: enable`` 头):
::

    POST {api_base}/api/v1/services/aigc/video-generation/video-synthesis
    Authorization: Bearer <api_key>
    X-DashScope-Async: enable
    Content-Type: application/json
    {
      "model": "wanx2.1-t2v-turbo",
      "input": {"prompt": "..."},
      "parameters": {"size": "1280*720", "duration": 5}
    }

   响应(立即返回 task_id):
::

    {
      "request_id": "...",
      "output": {"task_id": "task-xxx", "task_status": "PENDING"}
    }

2. 轮询任务状态:
::

    GET {api_base}/api/v1/tasks/{task_id}
    Authorization: Bearer <api_key>

   响应(SUCCEEDED):
::

    {
      "request_id": "...",
      "output": {
        "task_id": "...",
        "task_status": "SUCCEEDED",
        "video_url": "https://.../video.mp4",
        "submit_time": "...", "scheduled_time": "...", "end_time": "..."
      },
      "usage": {"video_duration": 5, "video_ratio": "16:9", "video_count": 1}
    }

   响应(FAILED):
::

    {"output": {"task_status": "FAILED", "code": "...", "message": "..."}}

策略
====
- 轮询间隔 5s,上限 10min(超时则 yield error_event)
- 每次轮询 yield ``data-task-progress`` 让前端进度条动起来
- ``task_status`` 状态机:PENDING → RUNNING → SUCCEEDED/FAILED/CANCELED/UNKNOWN
- 用户取消(``req.cancelled``)时立即返回,**不**主动撤销上游任务(DashScope
  无 cancel API);PR-6 引 TaskManager 后用单独的 cancel endpoint 通知后端继续
  消费这个 task_id

SSE 长连接限制
==============
单机 Tauri 直连本地后端,无中间代理,SSE 60s+ 没问题。
生产环境 / Nginx 后续上 TaskManager 才需要"断开重连续播",本期不接。
"""

from __future__ import annotations

import re
from typing import Dict, Optional, Tuple

from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

# ──────────────────────────────────────────────────────────────
# 工具
# ──────────────────────────────────────────────────────────────


# wanx t2v 各版本默认尺寸 / 时长
_DEFAULT_SIZE_BY_FAMILY: Dict[str, str] = {
    "wanx2.1-t2v":     "1280*720",
    "wanx-t2v":        "1280*720",
    "wanxiang-t2v":    "1280*720",
}
_DEFAULT_DURATION_S: int = 5         # 大部分版本最长 5s


def _default_size_for(model: str) -> str:
    low = model.lower()
    for prefix, size in _DEFAULT_SIZE_BY_FAMILY.items():
        if low.startswith(prefix):
            return size
    return "1280*720"


def _normalize_size(raw: Optional[str], model: str) -> str:
    if not raw:
        return _default_size_for(model)
    if "x" in raw and "*" not in raw:
        raw = raw.replace("x", "*")
    if re.fullmatch(r"\d+\*\d+", raw):
        return raw
    return _default_size_for(model)


def _build_endpoints(api_base: str) -> Tuple[str, str]:
    """返回 (submit_url, tasks_url_prefix)。

    api_base 通常配 ``compatible-mode/v1``,要还原成 native ``/api/v1``。
    """
    base = (api_base or "").rstrip("/")
    base = re.sub(r"/compatible-mode/v\d+$", "", base)
    base = re.sub(r"/v\d+$", "", base)
    submit = f"{base}/api/v1/services/aigc/video-generation/video-synthesis"
    tasks = f"{base}/api/v1/tasks"
    return submit, tasks


def _is_new_wan_video_api(model: str) -> bool:
    """wan2.x 新版视频 API(input.media + parameters.resolution);
    wanx2.1 老版用 input.img_url + parameters.size。"""
    low = (model or "").lower()
    if "/" in low:
        low = low.split("/", 1)[1]
    return low.startswith("wan2.") or low.startswith("wan2-")


def _resolution_param(params: Dict, default_size: str) -> str:
    """映射到新版 API 的 resolution(只支持 720P / 1080P)。

    优先用显式 resolution(表单 480p/720p/1080p),否则从 size(对话参数条
    1280*720)推。480P 新版不支持 -> 提升到 720P。"""
    res = params.get("resolution")
    if res:
        return "1080P" if "1080" in str(res).upper() else "720P"
    size = str(params.get("size") or default_size or "")
    nums = [int(x) for x in re.split(r"[*x]", size) if x.isdigit()]
    if nums and max(nums) >= 1920:
        return "1080P"
    return "720P"


def _image_ref_for_upstream(a) -> Optional[str]:
    """图片附件 -> DashScope 能取到的引用。

    - a.data(内存 bytes)-> base64 data URI
    - 公网 http(s) URL -> 原样
    - 本地 artifact URL(/v1/artifacts/<file>)-> 反查文件转 base64 data URI
      (DashScope 公网服务器够不到 localhost)
    取不到返 None。"""
    import base64 as _b64
    mime = (getattr(a, "mime", "") or "image/png")
    data = getattr(a, "data", None)
    if data:
        return "data:%s;base64,%s" % (mime, _b64.b64encode(data).decode())
    url = getattr(a, "url", None)
    if not url:
        return None
    low = url.lower()
    if low.startswith("http://") or low.startswith("https://"):
        return url
    fname = url.rsplit("/", 1)[-1]
    try:
        from chayuan.server.modality.router.artifacts import find_by_filename
        path = find_by_filename(fname)
        if path is not None:
            return "data:%s;base64,%s" % (mime, _b64.b64encode(path.read_bytes()).decode())
    except Exception:  # noqa: BLE001
        pass
    return url  # 兜底:原样(可能够不到)


def _first_image_attachment(req: "GenerateReq"):
    for a in (req.attachments or []):
        if (getattr(a, "mime", "") or "").startswith("image/"):
            return a
    return None


# ──────────────────────────────────────────────────────────────
# Connector
# ──────────────────────────────────────────────────────────────


@register(Capability.T2V, "dashscope")
class DashScopeT2VConnector(AsyncPollVideoConnector):
    """wanx-* 异步文生视频。

    继承 AsyncPollVideoConnector,只实现 4 个钩子:
      build_submit / parse_submit / build_poll / parse_poll
    公共的 generate/resume/_poll_loop 由基类提供。
    """

    # ──────────────────────────────────────────────────────────────
    # 构造提交体：文生视频 / 图生视频(I2V)分流
    # ──────────────────────────────────────────────────────────────
    def _build_submit_payload(self, req: GenerateReq) -> Dict:
        """构造 DashScope 异步任务提交 body。

        分流(均实测对齐 DashScope 真实契约):
          - wan2.x 新版:图生视频用 ``input.media=[{type:first_frame,url}]``,
            ``parameters.resolution``(720P/1080P);
          - wanx2.1 老版:图生视频用 ``input.img_url``,``parameters.size``。
        图片一律转公网 URL 或 base64 data URI(本地 artifact URL DashScope 够不到)。
        """
        params = req.params or {}
        prompt = (req.prompt or "").strip()
        try:
            duration = max(2, min(10, int(params.get("duration") or _DEFAULT_DURATION_S)))
        except (TypeError, ValueError):
            duration = _DEFAULT_DURATION_S

        img = _first_image_attachment(req)
        inp: Dict = {"prompt": prompt}

        if _is_new_wan_video_api(req.model):
            parameters: Dict = {
                "resolution": _resolution_param(params, _default_size_for(req.model)),
                "duration": duration,
            }
            if img is not None:
                ref = _image_ref_for_upstream(img)
                if ref:
                    inp["media"] = [{"type": "first_frame", "url": ref}]
        else:
            parameters = {
                "size": _normalize_size(params.get("size"), req.model),
                "duration": duration,
            }
            if img is not None:
                ref = _image_ref_for_upstream(img)
                if ref:
                    inp["img_url"] = ref

        payload: Dict = {"model": req.model, "input": inp, "parameters": parameters}
        seed = params.get("seed")
        if seed is not None:
            try:
                payload["parameters"]["seed"] = int(seed)
            except (TypeError, ValueError):
                pass
        return payload

    # ── 钩子 1: 构造提交三元组 ──

    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """返回 (submit_url, headers, body)。"""
        submit_url, _ = _build_endpoints(req.api_base)
        headers = {
            "Authorization": f"Bearer {req.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }
        body = self._build_submit_payload(req)
        return submit_url, headers, body

    # ── 钩子 2: 解析提交响应 → task_id ──

    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应中提取 task_id。"""
        return (resp_json.get("output") or {}).get("task_id") or ""

    # ── 钩子 3: 构造轮询二元组 ──

    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """返回 (poll_url, headers)。"""
        _, tasks_prefix = _build_endpoints(req.api_base)
        return f"{tasks_prefix}/{task_id}", {"Authorization": f"Bearer {req.api_key}"}

    # ── 钩子 4: 解析轮询响应 → PollResult ──

    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将 DashScope 轮询响应映射为标准 PollResult。"""
        output = resp_json.get("output") or {}
        st = (output.get("task_status") or "").upper()

        if st == "SUCCEEDED":
            video_url = output.get("video_url")
            urls = [video_url] if video_url else []
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=urls)

        if st == "FAILED":
            return PollResult(
                status=PollStatus.FAILED,
                error_message=output.get("message"),
            )

        if st == "PENDING":
            return PollResult(status=PollStatus.PENDING)

        if st == "RUNNING":
            return PollResult(status=PollStatus.RUNNING)

        if st == "CANCELED":
            return PollResult(status=PollStatus.CANCELED)

        return PollResult(status=PollStatus.UNKNOWN)

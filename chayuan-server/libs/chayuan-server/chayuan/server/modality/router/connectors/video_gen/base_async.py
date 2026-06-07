"""异步轮询型视频连接器基类。

把「提交→轮询→下载产物+进度+续传」的公共循环抽出,子类只实现 4 个钩子:
  build_submit(req)  -> (url, headers, body)
  parse_submit(resp_json) -> upstream_task_id
  build_poll(req, task_id) -> (url, headers)
  parse_poll(resp_json) -> PollResult

DashScope / Kling / (P2b)海螺/Vidu/智谱/Seedance/Runway 都继承它。

状态机(与 DashScope wanx 保持对齐):
  PENDING → RUNNING → SUCCEEDED / FAILED / CANCELED / UNKNOWN

进度估算算法与 DashScope connector 保持一致:
  - PENDING: min(10, int(elapsed_s * 2))
  - RUNNING: min(90, 25 + int(elapsed_s / 0.7))  — 假设平均 60s 出片;90% 上限留给下载
  - 其它: 0

轮询流程与 DashScope connector 保持对齐:
  - 先 asyncio.sleep(poll_interval_s) 再轮询(与 dashscope._poll_and_download 一致)
  - 临时网络抖动(httpx.RequestError)continue 不报错
  - 非 200 poll 响应才 yield error_event 退出
  - 用户取消 → error_event + return,不主动撤销上游任务
  - 超时 → error_event(含 task_id) + return
  - SUCCEEDED → 下载视频字节 → save_bytes → file_part(media_type, url, metadata) → finish_step_event
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Dict, List, Optional, Tuple

import httpx

from chayuan.server.modality.router.artifacts import save_bytes
from chayuan.server.modality.router.connectors.base import Connector
from chayuan.server.modality.router.protocol import GenerateReq
from chayuan.server.modality.router.sse_v5 import (
    data_part,
    error_event,
    file_part,
    finish_step_event,
    text_delta,
    text_end,
    text_start,
)

logger = logging.getLogger("chayuan.modality.connectors.video_gen.base_async")


# ──────────────────────────────────────────────────────────────
# 公共枚举 + 结果容器
# ──────────────────────────────────────────────────────────────


class PollStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    UNKNOWN = "UNKNOWN"


@dataclass
class PollResult:
    """子类 parse_poll 返回的标准化轮询结果。"""

    status: PollStatus
    percent: Optional[int] = None          # 子类可自行填(填了优先,None 则由基类估算)
    video_urls: List[str] = field(default_factory=list)
    error_message: Optional[str] = None


# ──────────────────────────────────────────────────────────────
# 工具
# ──────────────────────────────────────────────────────────────


def _estimate_percent(elapsed_s: float, status: str) -> int:
    """根据已耗时 + 任务状态估算进度百分比。

    算法与 DashScope connector 中 ``_estimate_percent`` 完全一致:
      - PENDING: 0-10%
      - RUNNING: elapsed/60 → 25-90%,上限 90 留 10% 给"下载视频"阶段
      - 其它状态返 0
    """
    if status == "PENDING":
        return min(10, int(elapsed_s * 2))
    if status == "RUNNING":
        # 假设平均 60s 出片;90% 上限确保 UI 不会卡 100% 等下载
        return min(90, 25 + int(elapsed_s / 0.7))
    return 0


async def _download_bytes(client: httpx.AsyncClient, url: str) -> bytes:
    """下载视频字节。

    视频可能 ≥ 几十 MB,timeout 单独放大(与 dashscope 实现保持一致)。
    """
    vresp = await client.get(url, timeout=httpx.Timeout(120.0))
    vresp.raise_for_status()
    return vresp.content


# ──────────────────────────────────────────────────────────────
# 基类
# ──────────────────────────────────────────────────────────────


class AsyncPollVideoConnector(Connector):
    """异步轮询型视频 Connector 基类。

    子类必须实现 4 个抽象钩子:
      build_submit / parse_submit / build_poll / parse_poll

    公共 generate/resume/_poll_loop 封装了完整的
    提交→轮询→下载+进度+续传循环。
    """

    # ── 子类可覆盖的类属性 ──
    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0
    media_type: str = "video/mp4"

    # ── 子类必须实现的 4 个钩子 ──

    @abstractmethod
    def build_submit(
        self, req: GenerateReq
    ) -> Tuple[str, Dict[str, str], Dict]:
        """构造提交请求三元组 (url, headers, body)。"""
        raise NotImplementedError

    @abstractmethod
    def parse_submit(self, resp_json: Dict) -> str:
        """从提交响应 JSON 中解析 upstream_task_id。"""
        raise NotImplementedError

    @abstractmethod
    def build_poll(
        self, req: GenerateReq, task_id: str
    ) -> Tuple[str, Dict[str, str]]:
        """构造轮询请求二元组 (url, headers)。"""
        raise NotImplementedError

    @abstractmethod
    def parse_poll(self, resp_json: Dict) -> PollResult:
        """将轮询响应 JSON 解析为标准化 PollResult。"""
        raise NotImplementedError

    # ── 公共流程 ──

    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        """完整的提交+轮询+下载流程。"""
        prompt = (req.prompt or "").strip()
        if not prompt:
            yield error_event("视频生成需要输入提示词描述", code="empty_prompt")
            return

        text_id = "t0"
        yield text_start(text_id)
        yield text_delta(text_id, "视频生成中,约需 30-120 秒,可关闭窗口稍后回来…")
        yield text_end(text_id)
        yield data_part("task-progress", {"percent": 2, "message": "提交任务"})

        url, headers, body = self.build_submit(req)
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. 提交
            try:
                resp = await client.post(url, json=body, headers=headers)
            except httpx.RequestError as e:
                yield error_event(f"无法连接视频接口: {e}", code="upstream_unreachable")
                return

            if resp.status_code not in (200, 201):
                try:
                    err_body = resp.json()
                except ValueError:
                    err_body = {"raw": resp.text[:500]}
                yield error_event(
                    f"上游 {resp.status_code}: "
                    f"{err_body.get('message') or err_body}",
                    code=f"upstream_{resp.status_code}",
                )
                return

            try:
                task_id = self.parse_submit(resp.json())
            except Exception as e:  # noqa: BLE001
                yield error_event(f"解析提交响应失败: {e}", code="bad_submit_resp")
                return

            if not task_id:
                yield error_event("上游未返回 task_id", code="no_task_id")
                return

            logger.info(
                "[async_video] task submitted: id=%s model=%s connector=%s",
                task_id, req.model, type(self).__name__,
            )
            yield data_part(
                "task-progress",
                {"percent": 5, "message": "任务已排队", "task_id": task_id},
            )

            # 2. 轮询 + 下载
            async for ev in self._poll_loop(client, req, task_id):
                yield ev

    async def resume(
        self, req: GenerateReq, upstream_task_id: str
    ) -> AsyncIterator[Dict]:
        """服务重启后接回现有 upstream_task_id,跳过 submit。"""
        text_id = "t0"
        yield text_start(text_id)
        yield text_delta(text_id, f"接回中断的视频任务({upstream_task_id})…")
        yield text_end(text_id)
        yield data_part(
            "task-progress",
            {"percent": 5, "message": "继续轮询", "task_id": upstream_task_id},
        )

        timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async for ev in self._poll_loop(client, req, upstream_task_id):
                yield ev

    async def _poll_loop(
        self,
        client: httpx.AsyncClient,
        req: GenerateReq,
        task_id: str,
    ) -> AsyncIterator[Dict]:
        """轮询 + 下载产物的共享实现 — generate / resume 都走这里。

        流程与 DashScope._poll_and_download 保持对齐:
          - asyncio.sleep 在 poll GET 之前(先等一轮再查)
          - httpx.RequestError 临时抖动 continue 不放弃
          - 非 200 状态码才 yield error + return
          - PENDING/RUNNING → yield task-progress + continue
          - SUCCEEDED → 下载视频 → save_bytes → file_part + finish_step_event
          - FAILED/CANCELED/UNKNOWN → yield error + return
        """
        started = time.monotonic()
        last_status = ""

        while True:
            # 取消检查
            if req.cancelled is not None and req.cancelled.is_set():
                yield error_event(
                    "用户已取消(上游任务可能继续跑完,不退费)",
                    code="cancelled",
                )
                return

            # 超时检查
            elapsed = time.monotonic() - started
            if elapsed > self.poll_timeout_s:
                yield error_event(
                    f"等待超时({int(elapsed)}s,任务可能仍在跑,task_id={task_id})",
                    code="poll_timeout",
                )
                return

            # 先等一轮再查(与 dashscope._poll_and_download 行为一致)
            await asyncio.sleep(self.poll_interval_s)

            # 轮询
            poll_url, poll_headers = self.build_poll(req, task_id)
            try:
                poll_resp = await client.get(poll_url, headers=poll_headers)
            except httpx.RequestError as e:
                # 临时网络抖动,不立即放弃,下一轮再试
                logger.warning("[async_video] poll transient error: %r", e)
                continue

            if poll_resp.status_code != 200:
                yield error_event(
                    f"轮询失败 {poll_resp.status_code}: {poll_resp.text[:200]}",
                    code=f"poll_{poll_resp.status_code}",
                )
                return

            resp_json = poll_resp.json()
            try:
                pr = self.parse_poll(resp_json)
            except Exception as e:  # noqa: BLE001
                yield error_event(f"解析轮询响应失败: {e}", code="bad_poll_resp")
                return

            status_str = pr.status.value
            if status_str != last_status:
                logger.info(
                    "[async_video] task=%s status %s → %s connector=%s",
                    task_id, last_status, status_str, type(self).__name__,
                )
                last_status = status_str

            if pr.status in (PollStatus.PENDING, PollStatus.RUNNING):
                # 子类若填了 percent 优先用,否则基类估算
                pct = (
                    pr.percent
                    if pr.percent is not None
                    else _estimate_percent(elapsed, status_str)
                )
                yield data_part(
                    "task-progress",
                    {
                        "percent": pct,
                        "message": "排队中" if pr.status == PollStatus.PENDING else "生成中",
                        "task_id": task_id,
                        "eta_s": max(0, int(60 - elapsed)),
                    },
                )
                continue

            if pr.status == PollStatus.SUCCEEDED:
                if not pr.video_urls:
                    yield error_event(
                        f"任务完成但未返回视频 URL: {resp_json}",
                        code="no_video_url",
                    )
                    return

                # 下载视频 + 落 artifacts
                yield data_part("task-progress", {"percent": 92, "message": "下载视频"})
                try:
                    vbytes = await _download_bytes(client, pr.video_urls[0])
                except Exception as e:  # noqa: BLE001
                    yield error_event(f"下载生成视频失败: {e}", code="download_failed")
                    return

                # 从 Content-Type 推断 MIME(与 dashscope 保持一致)
                mime = self.media_type
                saved = save_bytes(vbytes, mime)

                yield file_part(
                    media_type=mime,
                    url=saved["url"],
                    metadata={
                        "sha256": saved["sha256"],
                        "size_bytes": saved["size"],
                        "model": req.model,
                        "platform": req.platform_name,
                        "task_id": task_id,
                    },
                )
                yield data_part("task-progress", {"percent": 100, "message": "完成"})
                yield finish_step_event()
                return

            if pr.status in (PollStatus.FAILED, PollStatus.CANCELED, PollStatus.UNKNOWN):
                err_msg = pr.error_message or f"上游任务 {status_str}"
                yield error_event(
                    f"任务 {status_str}: {err_msg}",
                    code=f"task_{status_str.lower()}",
                )
                return

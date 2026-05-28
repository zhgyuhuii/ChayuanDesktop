"""Video Generation 模式 — 把 chat 输入当 video_subject 提交 vg_task。

ChatRequest.mode=='video_generation' 时,生成阶段不走 LLM,而是:
  1. 抽 state["request"].query 当 video_subject
  2. 调 video_generation.service.submit_task 提交任务(全自动 ai 模式)
  3. 把"任务已提交"+ task_id 作为 answer 注入 state

适用场景:
  ChatPage 选 video_generation mode 后用户发主题,后端自动 dispatch 到
  vg_task,不必跳到 /video-generation 单独入口。任务进度仍走 "我的视频"
  页(InProgressTasksPanel)看,这里只负责"chat 一句话发起任务"。

跟 /video-generation Chat 页(N4 自实现)的关系:
  - /video-generation 主入口(自实现 chat UI,深度 UX 控制)
  - 本 handler 只是给用户"在原生 ChatPage 也能发起任务"的额外路径,
    复用 ChatPage 的模型/KB/历史/工具栈,适合做"对话中插发起任务"
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from chayuan.server.chat.handlers.base import BaseModeHandler, register_handler

logger = logging.getLogger("chayuan.chat.handlers.video_generation")


class VideoGenerationHandler(BaseModeHandler):
    mode = "video_generation"
    needs_retrieval = False

    async def generate_override(
        self, state: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """把 chat query 当主题提交 vg_task,返回任务 id + 引导提示。

        失败也返 dict(error 字段),避免 fallback 到默认 LLM 路径生成无意
        义回复。
        """

        req = state.get("request")
        if req is None:
            return {"answer": "[video_generation] 缺 request 上下文"}
        query = (getattr(req, "query", "") or "").strip()
        if not query:
            return {"answer": "请提供视频主题"}

        # owner_id 在 chat 路径是 user 上下文;handler 通常拿 request_user
        # 不到时走 None(GUEST 全局)— 单机匿名模式安全
        owner_id: Optional[int] = None
        user_meta = state.get("user") or {}
        if isinstance(user_meta, dict):
            uid = user_meta.get("id")
            if isinstance(uid, int) and uid > 0:
                owner_id = uid

        try:
            from chayuan.server.video_generation import service as vg_service
            from chayuan.server.video_generation.schemas import VideoParams

            # 复用 VideoParams 默认值(画幅 9:16, voice piper, BGM random 等),
            # query 当 video_subject,script_source='ai' 全自动跑
            params = VideoParams(video_subject=query, script_source="ai")
            row = vg_service.submit_task(params, owner_id=owner_id, stop_at="video")
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg_handler] submit_task 失败 query=%r: %r", query[:40], e)
            return {
                "answer": (
                    f"提交视频生成任务失败:{type(e).__name__}: {e}\n\n"
                    "请检查 chayuan-server 视频生成模块是否就绪 — "
                    "1) 重启 server  2) seed-bundled-assets.py 拉 ImageMagick / piper voice"
                ),
            }

        task_id = row.get("task_id", "")
        return {
            "answer": (
                f"✨ 已提交视频生成任务\n\n"
                f"主题:{query}\n"
                f"task_id: `{task_id}`\n\n"
                f"任务后端正在跑(默认 4 并发);"
                f"前往 **视频生成 → 我的视频** 看进度条 + 完成后的成片。"
            ),
        }


register_handler(VideoGenerationHandler())

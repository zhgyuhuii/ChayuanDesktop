from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator


def sse_format(event: dict) -> str:
    """W3C EventSource 帧：data: <json>\\n\\n（浏览器 EventSource / net.sse 消费）。"""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


class EventStreamHub:
    """进程内扇出广播：每个浏览器 SSE 连接注册一个队列，broadcast 推给所有队列。

    队列满时丢最旧（背压保护，慢消费者不拖垮广播）。
    """

    def __init__(self, maxsize: int = 1000) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._maxsize = maxsize

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    async def broadcast(self, event: dict) -> None:
        for q in list(self._subscribers):
            if q.full():
                try:
                    q.get_nowait()  # 丢最旧
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(event)


async def stream_events(hub: EventStreamHub) -> AsyncIterator[str]:
    """把 hub 事件按 EventSource 帧逐个 yield（供 StreamingResponse 用，可独立单测）。

    注：无限流；调用方（HTTP 客户端断开）或 GeneratorExit 时经 finally 注销队列。
    """
    q = hub.register()
    try:
        while True:
            event = await q.get()
            yield sse_format(event)
    finally:
        hub.unregister(q)

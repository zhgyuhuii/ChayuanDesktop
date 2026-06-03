"""在线数字人公开页「正在观看人数」—— 进程内轻量 presence。

每个发布 token = 一个房间 ``{token: set[WebSocket]}``。访客公开页连 WS 即 join,
断开即 leave;每次变动向房内所有连接广播 ``{"op":"viewers","n":N}``。

为何不用 ``shared/ws_hub``:ws_hub 绑定开放平台 app_id/订阅/背压协议,观看计数
是单一职责的小事,自建更安全可控。sidecar 单进程,无需跨 worker fan-out。
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, Set

from starlette.websockets import WebSocket

logger = logging.getLogger("chayuan.dh.presence")

_rooms: Dict[str, Set[WebSocket]] = {}
_lock = asyncio.Lock()


def count(token: str) -> int:
    return len(_rooms.get(token, ()))


async def _broadcast(token: str) -> None:
    n = count(token)
    dead = []
    for ws in list(_rooms.get(token, ())):
        try:
            await ws.send_json({"op": "viewers", "n": n})
        except Exception:  # noqa: BLE001
            dead.append(ws)
    if dead:
        room = _rooms.get(token)
        if room:
            for ws in dead:
                room.discard(ws)


async def join(token: str, ws: WebSocket) -> int:
    async with _lock:
        _rooms.setdefault(token, set()).add(ws)
    await _broadcast(token)
    return count(token)


async def leave(token: str, ws: WebSocket) -> int:
    async with _lock:
        room = _rooms.get(token)
        if room:
            room.discard(ws)
            if not room:
                _rooms.pop(token, None)
    await _broadcast(token)
    return count(token)

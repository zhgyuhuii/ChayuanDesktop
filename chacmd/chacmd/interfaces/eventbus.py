from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Protocol


class EventBus(Protocol):
    """I6 — event/progress/A2A transport. Default InMemory (tests) / NATS (prod).

    Subject scheme (no IP): job.<id>.<stage> / agent.<nickname>.inbox / heartbeat.<nickname>.
    """

    async def publish(self, subject: str, message: dict) -> None: ...
    def subscribe(self, subject: str) -> AsyncIterator[dict]: ...


class InMemoryEventBus:
    """Default in-process bus with exact-subject matching (P0/tests)."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = {}

    async def publish(self, subject: str, message: dict) -> None:
        for q in self._queues.get(subject, []):
            await q.put(message)

    async def subscribe(self, subject: str) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.setdefault(subject, []).append(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._queues[subject].remove(q)

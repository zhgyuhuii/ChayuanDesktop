from __future__ import annotations

import json
from collections.abc import AsyncIterator


class NatsEventBus:
    """I6 — EventBus over NATS JetStream (NFR-P3, §6.22 无 IP).

    连接延迟建立（首次 publish/subscribe），故构造不依赖 NATS 可达。
    subject 前缀 job.* / heartbeat.* / agent.*，均为合法 NATS subject。
    """

    def __init__(self, url: str, stream: str = "CHACMD_EVENTS") -> None:
        self._url = url
        self._stream = stream
        self._nc = None  # nats.aio.client.Client
        self._js = None

    def _stream_subject(self, subject: str) -> str:
        return subject  # job.<id>.<kind> 已是合法 NATS subject

    async def _ensure(self) -> None:
        if self._nc is not None:
            return
        import nats

        self._nc = await nats.connect(self._url)
        self._js = self._nc.jetstream()
        # 幂等建 stream；已存在则忽略
        try:
            await self._js.add_stream(
                name=self._stream, subjects=["job.>", "heartbeat.>", "agent.>"]
            )
        except Exception:
            pass

    async def publish(self, subject: str, message: dict) -> None:
        await self._ensure()
        await self._js.publish(self._stream_subject(subject), json.dumps(message).encode())

    async def subscribe(self, subject: str) -> AsyncIterator[dict]:
        await self._ensure()
        sub = await self._js.subscribe(subject)
        try:
            async for msg in sub.messages:
                yield json.loads(msg.data.decode())
                await msg.ack()
        finally:
            await sub.unsubscribe()

    async def aclose(self) -> None:
        if self._nc is not None:
            await self._nc.close()

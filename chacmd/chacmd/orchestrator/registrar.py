from __future__ import annotations

from chacmd.domain.repository import ContainerRepository
from chacmd.gateway.protocol import Envelope


class Registrar:
    """Handles register/heartbeat envelopes → container registry (nickname→session, no IP)."""

    def __init__(self, containers: ContainerRepository) -> None:
        self._containers = containers

    async def handle(self, env: Envelope, session: str) -> None:
        if env.type == "register":
            await self._containers.upsert(nickname=env.nickname, session=session, dept=env.dept)
        elif env.type == "heartbeat":
            await self._containers.touch(env.nickname)

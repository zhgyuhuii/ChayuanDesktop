from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from chacmd.domain.models import ContainerReg
from chacmd.domain.repository import ContainerRepository


class LeaseMonitor:
    """Judge-dead via independent lease (NOT via 'any heartbeat on the bus') — §10.1-C3."""

    def __init__(self, containers: ContainerRepository, ttl_seconds: int = 30) -> None:
        self._containers = containers
        self._ttl = ttl_seconds

    async def dead_nicknames(self) -> list[str]:
        cutoff = datetime.now(UTC) - timedelta(seconds=self._ttl)
        async with self._containers._db.session() as s:  # noqa: SLF001 (repo shares db)
            rows = await s.execute(select(ContainerReg))
            dead = []
            for row in rows.scalars():
                hb = row.last_heartbeat
                if hb.tzinfo is None:
                    hb = hb.replace(tzinfo=UTC)
                if hb < cutoff:
                    dead.append(row.nickname)
            return dead

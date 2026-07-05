from datetime import UTC, datetime, timedelta

import pytest

from chacmd.domain.models import ContainerReg
from chacmd.domain.repository import ContainerRepository
from chacmd.interfaces.db import Database
from chacmd.orchestrator.lease import LeaseMonitor


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


@pytest.mark.asyncio
async def test_dead_containers_detected_by_stale_lease(db):
    creg = ContainerRepository(db)
    await creg.upsert(nickname="dev", session="s1", dept="d1")
    # Force stale heartbeat.
    async with db.session() as s:
        row = await s.get(ContainerReg, "dev")
        row.last_heartbeat = datetime.now(UTC) - timedelta(seconds=60)
        await s.commit()
    monitor = LeaseMonitor(creg, ttl_seconds=30)
    dead = await monitor.dead_nicknames()
    assert dead == ["dev"]


@pytest.mark.asyncio
async def test_fresh_container_not_dead(db):
    creg = ContainerRepository(db)
    await creg.upsert(nickname="dev", session="s1", dept="d1")
    monitor = LeaseMonitor(creg, ttl_seconds=30)
    assert await monitor.dead_nicknames() == []

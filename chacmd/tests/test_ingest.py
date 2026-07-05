import logging

import pytest

from chacmd.domain.events import Event
from chacmd.domain.repository import AuditRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.db import Database
from chacmd.interfaces.eventbus import InMemoryEventBus
from chacmd.orchestrator.ingest import EventIngest


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


@pytest.mark.asyncio
async def test_ingest_publishes_persists_and_transitions(db):
    jobs = JobRepository(db)
    job = await jobs.create(code="c", goal="g", dept="d1")
    await jobs.set_state(job.id, JobState.DISPATCHING)
    await jobs.set_state(job.id, JobState.RUNNING)

    bus = InMemoryEventBus()
    ingest = EventIngest(bus, jobs, AuditRepository(db))

    got = []
    import asyncio
    async def consume():
        async for m in bus.subscribe(f"job.{job.id}.succeeded"):
            got.append(m)
            return
    task = asyncio.create_task(consume())
    await asyncio.sleep(0)

    await ingest.handle(Event(job.id, "t1", "dev", "succeeded", 3, {"result": "ok"}))
    await asyncio.wait_for(task, timeout=1)

    assert got and got[0]["kind"] == "succeeded"
    assert (await jobs.get(job.id)).state == JobState.SUCCEEDED.value
    audit = await AuditRepository(db).list_for_job(job.id)
    assert audit[-1].kind == "succeeded"


@pytest.mark.asyncio
async def test_terminal_kinds_map_to_states(db):
    jobs = JobRepository(db)
    job = await jobs.create(code="c", goal="g", dept="d1")
    await jobs.set_state(job.id, JobState.DISPATCHING)
    await jobs.set_state(job.id, JobState.RUNNING)
    ingest = EventIngest(InMemoryEventBus(), jobs, AuditRepository(db))
    await ingest.handle(Event(job.id, "t1", "dev", "interrupted", 2, {}))
    assert (await jobs.get(job.id)).state == JobState.INTERRUPTED.value


@pytest.mark.asyncio
async def test_illegal_transition_is_logged_not_raised(db, caplog):
    jobs = JobRepository(db)
    job = await jobs.create(code="c", goal="g", dept="d1")
    # job is left in QUEUED; "succeeded" targets a state QUEUED cannot legally transition to.
    ingest = EventIngest(InMemoryEventBus(), jobs, AuditRepository(db))
    caplog.set_level(logging.WARNING)
    await ingest.handle(Event(job.id, "t1", "dev", "succeeded", 1, {}))
    assert (await jobs.get(job.id)).state == JobState.QUEUED.value
    assert "illegal transition" in caplog.text

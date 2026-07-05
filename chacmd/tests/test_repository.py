import pytest

from chacmd.domain.repository import ContainerRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.db import Database


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


@pytest.mark.asyncio
async def test_create_and_get_job(db):
    repo = JobRepository(db)
    job = await repo.create(code="world-rank-app", goal="build ranking app", dept="d1")
    assert job.state == JobState.QUEUED.value
    fetched = await repo.get(job.id)
    assert fetched.code == "world-rank-app"
    assert fetched.dept == "d1"


@pytest.mark.asyncio
async def test_set_state_persists(db):
    repo = JobRepository(db)
    job = await repo.create(code="c", goal="g", dept="d1")
    await repo.set_state(job.id, JobState.DISPATCHING)
    assert (await repo.get(job.id)).state == JobState.DISPATCHING.value


@pytest.mark.asyncio
async def test_set_state_unknown_job_raises(db):
    repo = JobRepository(db)
    with pytest.raises(KeyError):
        await repo.set_state("does-not-exist", JobState.DISPATCHING)


@pytest.mark.asyncio
async def test_container_register_resolve_by_nickname(db):
    creg = ContainerRepository(db)
    await creg.upsert(nickname="dev", session="s1", dept="d1")
    row = await creg.resolve("dev")
    assert row.session == "s1"
    assert not hasattr(row, "ip")  # model has no ip column at all

from collections.abc import AsyncIterator

import pytest

from chacmd.domain.events import Event
from chacmd.domain.repository import AuditRepository, ContainerRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.agent_adapter import AgentAdapter, DispatchSpec, FakeAgentAdapter
from chacmd.interfaces.chayuan_client import FakeChayuanClient
from chacmd.interfaces.db import Database
from chacmd.interfaces.eventbus import InMemoryEventBus
from chacmd.orchestrator.budget import BudgetGuard
from chacmd.orchestrator.dispatcher import Dispatcher
from chacmd.orchestrator.ingest import EventIngest


class _TokenBurningAdapter(AgentAdapter):
    """每个 progress 事件 payload 带固定 tokens，用于验证预算 kill。"""

    def __init__(self, per_step_tokens: int, steps: int = 10) -> None:
        self._t, self._steps = per_step_tokens, steps
        self.cancelled = False

    async def dispatch(self, spec: DispatchSpec) -> AsyncIterator[Event]:
        seq = 0
        yield Event(spec.job_id, spec.task_id, spec.nickname, "started", seq, {})
        for i in range(self._steps):
            if self.cancelled:
                return
            seq += 1
            yield Event(spec.job_id, spec.task_id, spec.nickname, "progress", seq,
                        {"step": i, "tokens": self._t})
        seq += 1
        yield Event(spec.job_id, spec.task_id, spec.nickname, "succeeded", seq, {})

    async def health(self) -> bool:
        return True

    async def cancel(self, job_id: str, task_id: str) -> None:
        self.cancelled = True

    def manifest(self) -> dict:
        return {"name": "token-burner"}


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


@pytest.mark.asyncio
async def test_dispatch_by_nickname_runs_to_success(db):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    await containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await jobs.create(code="c", goal="build app", dept="d1")

    ingest = EventIngest(InMemoryEventBus(), jobs, AuditRepository(db))
    disp = Dispatcher(
        jobs=jobs, containers=containers, chayuan=FakeChayuanClient(),
        adapter=FakeAgentAdapter(steps=["a", "b"]), ingest=ingest,
    )
    await disp.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="you are dev")
    assert (await jobs.get(job.id)).state == JobState.SUCCEEDED.value


@pytest.mark.asyncio
async def test_dispatch_kills_job_over_token_budget(db):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    await containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await jobs.create(code="c", goal="build", dept="d1", token_budget=250)  # 预算 250

    adapter = _TokenBurningAdapter(per_step_tokens=100, steps=10)  # 累计 100,200,300...
    disp = Dispatcher(
        jobs=jobs, containers=containers, chayuan=FakeChayuanClient(),
        adapter=adapter,
        ingest=EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)),
        budget=BudgetGuard(jobs),
    )
    await disp.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="p")
    final = await jobs.get(job.id)
    assert final.state == JobState.FAILED.value  # 第 3 步累计 300>250 被 kill
    assert adapter.cancelled is True
    assert final.tokens_used >= 250


@pytest.mark.asyncio
async def test_dispatch_within_budget_succeeds(db):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    await containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await jobs.create(code="c", goal="build", dept="d1", token_budget=100000)

    adapter = _TokenBurningAdapter(per_step_tokens=100, steps=3)
    disp = Dispatcher(
        jobs=jobs, containers=containers, chayuan=FakeChayuanClient(),
        adapter=adapter,
        ingest=EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)),
        budget=BudgetGuard(jobs),
    )
    await disp.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="p")
    assert (await jobs.get(job.id)).state == JobState.SUCCEEDED.value


@pytest.mark.asyncio
async def test_dispatch_denied_by_authz_does_not_run(db):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    await containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await jobs.create(code="c", goal="g", dept="d1")
    chayuan = FakeChayuanClient()
    chayuan.deny("u1", "container:dev", "dispatch")
    disp = Dispatcher(
        jobs, containers, chayuan, FakeAgentAdapter(steps=["a"]),
        EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)),
    )
    with pytest.raises(PermissionError):
        await disp.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="p")
    assert (await jobs.get(job.id)).state == JobState.QUEUED.value


@pytest.mark.asyncio
async def test_dispatch_unknown_nickname_raises(db):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    job = await jobs.create(code="c", goal="g", dept="d1")
    disp = Dispatcher(
        jobs, containers, FakeChayuanClient(), FakeAgentAdapter(steps=[]),
        EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)),
    )
    with pytest.raises(KeyError):
        await disp.dispatch(job_id=job.id, nickname="ghost", subject="u1", system_prompt="p")


@pytest.mark.asyncio
async def test_dispatch_unknown_job_raises(db):
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    await containers.upsert(nickname="dev", session="s1", dept="d1")
    disp = Dispatcher(
        jobs, containers, FakeChayuanClient(), FakeAgentAdapter(steps=["a"]),
        EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)),
    )
    with pytest.raises(KeyError):
        await disp.dispatch(job_id="does-not-exist", nickname="dev", subject="u1", system_prompt="p")

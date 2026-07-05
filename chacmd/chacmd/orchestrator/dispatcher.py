from __future__ import annotations

from chacmd.domain.repository import ContainerRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.agent_adapter import AgentAdapter, DispatchSpec
from chacmd.interfaces.chayuan_client import ChayuanClient
from chacmd.interfaces.rbac import RbacPolicy, Resource, Subject
from chacmd.orchestrator.ingest import EventIngest


class Dispatcher:
    """@nickname dispatch (fast path, no LLM routing in P0) → authz → AgentAdapter → ingest.

    鉴权双轨：配置了本地 ``rbac`` 时走 ChaCMD 资源级 RBAC（#14，主体×container×dispatch +
    部门隔离）；否则回退 ``chayuan.authorize``（察元 scope 兼容层）。
    """

    def __init__(
        self,
        jobs: JobRepository,
        containers: ContainerRepository,
        chayuan: ChayuanClient,
        adapter: AgentAdapter,
        ingest: EventIngest,
        budget: object | None = None,
        rbac: RbacPolicy | None = None,
    ) -> None:
        self._jobs = jobs
        self._containers = containers
        self._chayuan = chayuan
        self._adapter = adapter
        self._ingest = ingest
        self._budget = budget
        self._rbac = rbac

    async def dispatch(
        self, job_id: str, nickname: str, subject: str | Subject, system_prompt: str
    ) -> None:
        container = await self._containers.resolve(nickname)
        if container is None:
            raise KeyError(f"unknown nickname: {nickname}")

        if self._rbac is not None:
            subj = subject if isinstance(subject, Subject) else Subject(str(subject))
            res = Resource("container", nickname, tenant=getattr(container, "dept", None))
            if not self._rbac.check(subj, res, "dispatch"):
                raise PermissionError(f"{subj.id} not allowed to dispatch to {nickname}")
        else:
            subject_id = subject.id if isinstance(subject, Subject) else subject
            allowed = await self._chayuan.authorize(
                subject=subject_id, resource=f"container:{nickname}", action="dispatch"
            )
            if not allowed:
                raise PermissionError(f"{subject_id} not allowed to dispatch to {nickname}")

        job = await self._jobs.get(job_id)
        if job is None:
            raise KeyError(f"unknown job: {job_id}")
        await self._jobs.set_state(job_id, JobState.DISPATCHING)
        spec = DispatchSpec(
            job_id=job_id, task_id=job_id, nickname=nickname, goal=job.goal, system_prompt=system_prompt
        )
        async for event in self._adapter.dispatch(spec):
            await self._ingest.handle(event)
            tokens = event.payload.get("tokens", 0) if event.payload else 0
            if self._budget is not None and tokens:
                if not await self._budget.charge(job_id, tokens):
                    # 超 per-job 预算：kill adapter + 置 FAILED（NFR-C1）
                    await self._adapter.cancel(job_id, job_id)
                    await self._jobs.set_state(job_id, JobState.FAILED)
                    break

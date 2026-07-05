from __future__ import annotations

import logging

from chacmd.domain.events import Event
from chacmd.domain.repository import AuditRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.eventbus import EventBus

logger = logging.getLogger(__name__)

# Which event kinds drive a terminal/approval job-state transition.
_KIND_TO_STATE = {
    "started": JobState.RUNNING,
    "pending_approval": JobState.PENDING_APPROVAL,
    "succeeded": JobState.SUCCEEDED,
    "failed": JobState.FAILED,
    "interrupted": JobState.INTERRUPTED,
}


class EventIngest:
    """Unified event sink: publish to bus + append audit + drive job state (§6.6/§C9)."""

    def __init__(self, bus: EventBus, jobs: JobRepository, audit: AuditRepository) -> None:
        self._bus = bus
        self._jobs = jobs
        self._audit = audit

    async def handle(self, e: Event) -> None:
        from chacmd.observability.otel import inject_traceparent

        msg = inject_traceparent(
            {"kind": e.kind, "seq": e.seq, "payload": e.payload}, job_id=e.job_id
        )
        await self._bus.publish(e.subject(), msg)
        await self._audit.append(e)
        target = _KIND_TO_STATE.get(e.kind)
        if target is not None:
            job = await self._jobs.get(e.job_id)
            if job and JobState(job.state) != target:
                from chacmd.domain.state import can_transition
                if can_transition(JobState(job.state), target):
                    await self._jobs.set_state(e.job_id, target)
                else:
                    logger.warning(
                        "dropping illegal transition %s -> %s for job %s (event kind=%s)",
                        job.state, target.value, e.job_id, e.kind,
                    )

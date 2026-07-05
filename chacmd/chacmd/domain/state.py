from __future__ import annotations

from enum import StrEnum


class JobState(StrEnum):
    QUEUED = "queued"
    DISPATCHING = "dispatching"
    RUNNING = "running"
    PENDING_APPROVAL = "pending_approval"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"


# TaskState mirrors JobState for P0 (single-task jobs); kept as an alias for clarity.
TaskState = JobState

_ALLOWED: dict[JobState, set[JobState]] = {
    JobState.QUEUED: {JobState.DISPATCHING, JobState.CANCELLED},
    JobState.DISPATCHING: {JobState.RUNNING, JobState.FAILED, JobState.INTERRUPTED},
    JobState.RUNNING: {
        JobState.PENDING_APPROVAL,
        JobState.SUCCEEDED,
        JobState.FAILED,
        JobState.INTERRUPTED,
        JobState.CANCELLED,
    },
    JobState.PENDING_APPROVAL: {JobState.RUNNING, JobState.CANCELLED, JobState.FAILED},
    JobState.SUCCEEDED: set(),
    JobState.FAILED: set(),
    JobState.INTERRUPTED: set(),
    JobState.CANCELLED: set(),
}


def can_transition(src: JobState, dst: JobState) -> bool:
    return dst in _ALLOWED[src]


def transition(src: JobState, dst: JobState) -> JobState:
    if not can_transition(src, dst):
        raise ValueError(f"illegal transition {src} -> {dst}")
    return dst

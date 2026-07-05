from __future__ import annotations

import abc
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from chacmd.domain.events import Event


@dataclass
class DispatchSpec:
    job_id: str
    task_id: str
    nickname: str
    goal: str
    system_prompt: str
    inputs: dict[str, Any] | None = None


class AgentAdapter(abc.ABC):
    """I5 — pluggable agent runtime. Default OpenHands / swap Codex, Hermes, OpenClaw, Claude Code.

    Written as an ABC so a new agent is drop-in (no `if system_id` in core).
    """

    @abc.abstractmethod
    def dispatch(self, spec: DispatchSpec) -> AsyncIterator[Event]: ...

    @abc.abstractmethod
    async def health(self) -> bool: ...

    @abc.abstractmethod
    async def cancel(self, job_id: str, task_id: str) -> None: ...

    @abc.abstractmethod
    def manifest(self) -> dict[str, Any]: ...


class FakeAgentAdapter(AgentAdapter):
    """Test double: deterministic event stream, no external process."""

    def __init__(self, steps: list[str]) -> None:
        self._steps = steps
        self._cancelled: set[tuple[str, str]] = set()

    async def dispatch(self, spec: DispatchSpec) -> AsyncIterator[Event]:
        seq = 0
        yield Event(spec.job_id, spec.task_id, spec.nickname, "started", seq, {"goal": spec.goal})
        for step in self._steps:
            if (spec.job_id, spec.task_id) in self._cancelled:
                seq += 1
                yield Event(spec.job_id, spec.task_id, spec.nickname, "interrupted", seq, {"at": step})
                return
            seq += 1
            yield Event(spec.job_id, spec.task_id, spec.nickname, "progress", seq, {"step": step})
        seq += 1
        yield Event(spec.job_id, spec.task_id, spec.nickname, "succeeded", seq, {"result": "ok"})

    async def health(self) -> bool:
        return True

    async def cancel(self, job_id: str, task_id: str) -> None:
        self._cancelled.add((job_id, task_id))

    def manifest(self) -> dict[str, Any]:
        return {"name": "fake", "capabilities": ["stream", "cancel"]}

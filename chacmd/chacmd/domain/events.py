from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Event:
    """Unified event envelope streamed from any agent through the bus (§6.6)."""

    job_id: str
    task_id: str
    container: str          # nickname (logical, no IP)
    kind: str               # started | progress | pending_approval | succeeded | failed | interrupted
    seq: int
    payload: dict[str, Any] = field(default_factory=dict)

    def subject(self) -> str:
        return f"job.{self.job_id}.{self.kind}"

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Reverse-WS message types (container→gateway and gateway→container).
VALID_TYPES = {"register", "heartbeat", "dispatch", "event", "result", "cancel"}


@dataclass
class Envelope:
    type: str
    nickname: str          # logical id (no IP)
    dept: str
    data: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.type not in VALID_TYPES:
            raise ValueError(f"unknown envelope type: {self.type}")

    def to_json(self) -> dict:
        return {"type": self.type, "nickname": self.nickname, "dept": self.dept, "data": self.data}

    @staticmethod
    def from_json(d: dict) -> Envelope:
        return Envelope(type=d["type"], nickname=d["nickname"], dept=d["dept"], data=d.get("data", {}))

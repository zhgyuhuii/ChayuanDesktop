from __future__ import annotations

import ipaddress
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol


def _looks_like_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


@dataclass(frozen=True)
class LogicalAddress:
    """Logical, IP-free address. kind ∈ {nickname, subject, volume, endpoint}."""

    kind: str
    value: str

    @staticmethod
    def nickname(name: str) -> LogicalAddress:
        if _looks_like_ip(name):
            raise ValueError(f"nickname must not be an IP: {name}")
        return LogicalAddress("nickname", name)

    @staticmethod
    def subject(subj: str) -> LogicalAddress:
        return LogicalAddress("subject", subj)

    @staticmethod
    def volume(job_id: str) -> LogicalAddress:
        return LogicalAddress("volume", f"/workspace/{job_id}")

    @staticmethod
    def endpoint(service_name: str) -> LogicalAddress:
        if _looks_like_ip(service_name):
            raise ValueError(f"endpoint must be a service name, not an IP: {service_name}")
        return LogicalAddress("endpoint", service_name)


Handler = Callable[[dict], Awaitable[None] | None]


class Transport(Protocol):
    """I10 — resolve logical name → channel, hiding IP. Swap: reverse-WS / bus / overlay-mesh."""

    async def bind(self, addr: LogicalAddress, handler: Handler) -> None: ...
    async def send(self, addr: LogicalAddress, message: dict) -> None: ...


class InProcessTransport:
    """Default test transport: pure in-process routing by logical name."""

    def __init__(self) -> None:
        self._handlers: dict[tuple[str, str], Handler] = {}

    async def bind(self, addr: LogicalAddress, handler: Handler) -> None:
        self._handlers[(addr.kind, addr.value)] = handler

    async def send(self, addr: LogicalAddress, message: dict) -> None:
        handler = self._handlers.get((addr.kind, addr.value))
        if handler is None:
            raise KeyError(f"no bound handler for {addr}")
        result = handler(message)
        if result is not None:
            await result

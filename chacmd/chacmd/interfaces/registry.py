from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ServiceInstance:
    name: str
    handle: str  # logical handle (reverse-WS session id / bus subject) — NEVER an IP
    meta: dict[str, Any] = field(default_factory=dict)


class ServiceRegistry(Protocol):
    """I4 — service registration/discovery. Default InProcess / swap Nacos, Consul, etcd.

    Registered handles are logical (session/subject), enabling OpenFeign-by-service-name (§6.23).
    """

    async def register(self, instance: ServiceInstance) -> None: ...
    async def deregister(self, name: str, handle: str) -> None: ...
    async def resolve(self, name: str) -> list[ServiceInstance]: ...


class ConfigSource(Protocol):
    """I4 — config source. Default InProcess/env / swap Nacos config center."""

    def get(self, key: str, default: Any = None) -> Any: ...


class InProcessServiceRegistry:
    def __init__(self) -> None:
        self._by_name: dict[str, list[ServiceInstance]] = {}

    async def register(self, instance: ServiceInstance) -> None:
        instances = self._by_name.setdefault(instance.name, [])
        instances[:] = [i for i in instances if i.handle != instance.handle]
        instances.append(instance)

    async def deregister(self, name: str, handle: str) -> None:
        self._by_name[name] = [i for i in self._by_name.get(name, []) if i.handle != handle]

    async def resolve(self, name: str) -> list[ServiceInstance]:
        return list(self._by_name.get(name, []))


class InProcessConfigSource:
    def __init__(self, values: dict[str, Any]) -> None:
        self._values = dict(values)

    def get(self, key: str, default: Any = None) -> Any:
        return self._values.get(key, default)

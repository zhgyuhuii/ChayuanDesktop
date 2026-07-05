"""#21 Nacos provider（I4 SPI 的可选实现）。

实现 ServiceRegistry/ConfigSource 的 Nacos 后端（Nacos Open API v1）。逻辑句柄经 metadata
携带（非 IP），支撑 OpenFeign 按服务名调用。后台可切"内置 | Nacos"（select_registry）。

只依赖一个 async http（httpx.AsyncClient 形态）Protocol，便于 mock 单测契约；真注册需 Nacos。
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from chacmd.interfaces.registry import (
    InProcessServiceRegistry,
    ServiceInstance,
    ServiceRegistry,
)


class _Http(Protocol):
    async def post(self, url: str, params: dict | None = None) -> Any: ...
    async def delete(self, url: str, params: dict | None = None) -> Any: ...
    async def get(self, url: str, params: dict | None = None) -> Any: ...


class NacosServiceRegistry:
    """Nacos 服务注册发现。handle=逻辑句柄，塞进 metadata，ip 字段仅占位。"""

    def __init__(self, http: _Http, *, namespace: str = "public", group: str = "DEFAULT_GROUP") -> None:
        self._http = http
        self._ns = namespace
        self._group = group

    async def register(self, instance: ServiceInstance) -> None:
        meta = {**instance.meta, "handle": instance.handle}
        resp = await self._http.post(
            "/nacos/v1/ns/instance",
            params={
                "serviceName": instance.name,
                "ip": instance.handle or "logical",
                "port": instance.meta.get("port", 0),
                "namespaceId": self._ns,
                "groupName": self._group,
                "metadata": json.dumps(meta, ensure_ascii=False),
            },
        )
        resp.raise_for_status()

    async def deregister(self, name: str, handle: str) -> None:
        resp = await self._http.delete(
            "/nacos/v1/ns/instance",
            params={
                "serviceName": name,
                "ip": handle,
                "namespaceId": self._ns,
                "groupName": self._group,
            },
        )
        resp.raise_for_status()

    async def resolve(self, name: str) -> list[ServiceInstance]:
        resp = await self._http.get(
            "/nacos/v1/ns/instance/list",
            params={"serviceName": name, "namespaceId": self._ns, "groupName": self._group},
        )
        resp.raise_for_status()
        data = resp.json() or {}
        out: list[ServiceInstance] = []
        for host in data.get("hosts", []):
            meta = host.get("metadata", {}) or {}
            handle = meta.get("handle", host.get("ip"))
            out.append(ServiceInstance(name=name, handle=handle, meta=meta))
        return out


class NacosConfigSource:
    """Nacos 配置中心。异步 load 拉取配置到缓存，sync get 读缓存（贴合 I4 ConfigSource.get 同步契约）。"""

    def __init__(self, http: _Http, *, namespace: str = "public") -> None:
        self._http = http
        self._ns = namespace
        self._cache: dict[str, Any] = {}

    async def load(self, data_id: str, *, group: str = "DEFAULT_GROUP") -> None:
        resp = await self._http.get(
            "/nacos/v1/cs/configs",
            params={"dataId": data_id, "group": group, "tenant": self._ns},
        )
        resp.raise_for_status()
        text = resp.json()
        if isinstance(text, str) and text:
            self._cache = json.loads(text)
        elif isinstance(text, dict):
            self._cache = text

    def get(self, key: str, default: Any = None) -> Any:
        return self._cache.get(key, default)


def select_registry(kind: str, *, http: _Http | None = None, **kw: Any) -> ServiceRegistry:
    """后台开关：'builtin' → 内置内存实现；'nacos' → Nacos（需 http）。"""
    if kind == "nacos":
        if http is None:
            raise ValueError("nacos registry requires http client")
        return NacosServiceRegistry(http, **kw)
    return InProcessServiceRegistry()


__all__ = ["NacosServiceRegistry", "NacosConfigSource", "select_registry"]

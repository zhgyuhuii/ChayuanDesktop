from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class SandboxSpec:
    nickname: str
    image: str
    mounts: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)  # 配置下发(#10)：模型/Key/BaseURL
    # #2 复制/供给参数化：端口映射/用户名/密码/权限/动态装应用/工作目录 bind
    ports: dict[int, int] = field(default_factory=dict)  # container_port -> host_port(0=自动)
    username: str | None = None
    password: str | None = None
    permissions: tuple[str, ...] = ()
    install_apps: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for m in self.mounts:
            if "docker.sock" in m:
                raise ValueError("docker socket must never be mounted into a sandbox (R4)")


@dataclass
class SandboxHandle:
    id: str
    nickname: str


class Sandbox(Protocol):
    """I7 — isolation runtime. Default rootless Docker / swap gVisor, Kata, 国产安全容器."""

    async def create(self, spec: SandboxSpec) -> SandboxHandle: ...
    async def destroy(self, handle_id: str) -> None: ...


class FakeSandbox:
    """Test double: track live handles, no real containers."""

    def __init__(self) -> None:
        self.live: dict[str, SandboxHandle] = {}

    async def create(self, spec: SandboxSpec) -> SandboxHandle:
        handle = SandboxHandle(id=uuid.uuid4().hex, nickname=spec.nickname)
        self.live[handle.id] = handle
        return handle

    async def destroy(self, handle_id: str) -> None:
        self.live.pop(handle_id, None)

from __future__ import annotations

from chacmd.interfaces.sandbox import SandboxHandle, SandboxSpec


class Provisioner:
    """容器供给(#2 一键起子容器) + 配置下发(#10)。

    供给成功即把 nickname 注册到覆盖网（用 handle.id 作 session 句柄，非 IP，§6.22）。
    """

    def __init__(self, sandbox: object, containers: object, image: str) -> None:
        self._sandbox = sandbox
        self._containers = containers
        self._image = image

    async def provision(
        self, nickname: str, dept: str, env: dict | None = None
    ) -> SandboxHandle:
        spec = SandboxSpec(nickname=nickname, image=self._image, env=env or {})
        handle = await self._sandbox.create(spec)
        await self._containers.upsert(nickname=nickname, session=handle.id, dept=dept)
        return handle

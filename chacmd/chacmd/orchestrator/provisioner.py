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
        self,
        nickname: str,
        dept: str,
        env: dict | None = None,
        *,
        ports: dict[int, int] | None = None,
        username: str | None = None,
        password: str | None = None,
        permissions: tuple[str, ...] = (),
        install_apps: tuple[str, ...] = (),
        job_id: str | None = None,
        code: str | None = None,
    ) -> SandboxHandle:
        """一键从基座镜像供给 agent 容器（#2）+ 配置下发（#10）。

        提供 job_id + code 时，把共享卷 per-job 子目录 bind 进容器 ``$HOME/<code>``
        （统一工作空间 #4，禁整卷挂载 NFR-T1）。
        """
        mounts: list[str] = []
        if job_id is not None and code is not None:
            mounts.append(f"/workspace/{job_id}:/home/{nickname}/{code}")
        spec = SandboxSpec(
            nickname=nickname,
            image=self._image,
            env=env or {},
            mounts=mounts,
            ports=ports or {},
            username=username,
            password=password,
            permissions=permissions,
            install_apps=install_apps,
        )
        handle = await self._sandbox.create(spec)
        await self._containers.upsert(nickname=nickname, session=handle.id, dept=dept)
        return handle

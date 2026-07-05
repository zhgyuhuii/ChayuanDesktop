from __future__ import annotations

import uuid

from chacmd.interfaces.sandbox import SandboxHandle, SandboxSpec


def build_run_kwargs(spec: SandboxSpec) -> dict:
    """容器加固基线（NFR-SEC1/SEC2）：cap-drop ALL、no-new-privileges、
    read-only rootfs、默认拒绝出站、内存/PID 上限。

    docker socket 永不入容器（SandboxSpec.__post_init__ 已在构造期拦 R4）。
    """
    return {
        "image": spec.image,
        "name": f"chacmd-{spec.nickname}-{uuid.uuid4().hex[:8]}",
        "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges"],
        "read_only": True,
        "network_mode": "none",  # 默认拒绝出站；需网络的角色由 per-role 白名单放开(P1)
        "mem_limit": "3g",
        "pids_limit": 512,
        "volumes": {},  # per-job 卷由 Provisioner 单独 bind(Task 9/#10)
        "environment": spec.env,  # 配置下发(#10)：模型/Key/BaseURL 注入容器 env
        "detach": True,
    }


class DockerSandbox:
    """I7 — rootless Docker sandbox。真起容器需 docker daemon(rootless)。"""

    def __init__(self) -> None:
        self._client = None

    def _ensure(self):
        if self._client is None:
            import docker

            self._client = docker.from_env()
        return self._client

    async def create(self, spec: SandboxSpec) -> SandboxHandle:
        client = self._ensure()
        container = client.containers.run(**build_run_kwargs(spec))
        return SandboxHandle(id=container.id, nickname=spec.nickname)

    async def destroy(self, handle_id: str) -> None:
        client = self._ensure()
        try:
            c = client.containers.get(handle_id)
            c.remove(force=True)
        except Exception:
            pass

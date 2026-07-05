import pytest

from chacmd.interfaces.sandbox import FakeSandbox
from chacmd.orchestrator.provisioner import Provisioner


class _Containers:
    def __init__(self) -> None:
        self.regs: dict[str, tuple[str, str]] = {}

    async def upsert(self, nickname: str, session: str, dept: str) -> None:
        self.regs[nickname] = (session, dept)


@pytest.mark.asyncio
async def test_provision_creates_sandbox_and_registers():
    sb, containers = FakeSandbox(), _Containers()
    p = Provisioner(sb, containers, image="chatop-ai:latest")
    handle = await p.provision(nickname="worker-1", dept="d1", env={"MODEL": "deepseek"})
    assert handle.nickname == "worker-1"
    assert "worker-1" in containers.regs   # 供给后注册到覆盖网(#2)
    assert handle.id in sb.live


@pytest.mark.asyncio
async def test_provision_passes_env_to_spec():
    # 配置下发(#10)：env 进 SandboxSpec.env
    captured = {}

    class _CapturingSandbox(FakeSandbox):
        async def create(self, spec):
            captured["env"] = spec.env
            return await super().create(spec)

    p = Provisioner(_CapturingSandbox(), _Containers(), image="x")
    await p.provision(nickname="w", dept="d1", env={"BASE_URL": "http://gw"})
    assert captured["env"] == {"BASE_URL": "http://gw"}

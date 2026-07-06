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


@pytest.mark.asyncio
async def test_provision_parameterized_ports_user_apps():
    # #2 供给参数化：端口/用户名/密码/权限/装应用透传到 spec
    captured = {}

    class _CapturingSandbox(FakeSandbox):
        async def create(self, spec):
            captured["spec"] = spec
            return await super().create(spec)

    p = Provisioner(_CapturingSandbox(), _Containers(), image="x")
    await p.provision(
        nickname="w",
        dept="d1",
        ports={8080: 0},
        username="agent",
        password="s3cr3t",
        permissions=("net.egress",),
        install_apps=("openclaw", "codex"),
    )
    spec = captured["spec"]
    assert spec.ports == {8080: 0}
    assert spec.username == "agent"
    assert spec.install_apps == ("openclaw", "codex")


@pytest.mark.asyncio
async def test_provision_binds_per_job_workspace():
    # #4 统一工作空间：per-job 子目录 bind 进容器 $HOME/<code>（禁整卷）
    captured = {}

    class _CapturingSandbox(FakeSandbox):
        async def create(self, spec):
            captured["mounts"] = spec.mounts
            return await super().create(spec)

    p = Provisioner(_CapturingSandbox(), _Containers(), image="x")
    await p.provision(nickname="w", dept="d1", job_id="job-9", code="proj")
    assert captured["mounts"] == ["/workspace/job-9:/home/w/proj"]

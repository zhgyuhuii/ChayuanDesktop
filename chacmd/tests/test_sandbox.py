import pytest

from chacmd.interfaces.sandbox import FakeSandbox, Sandbox, SandboxSpec


@pytest.mark.asyncio
async def test_fake_sandbox_create_and_destroy():
    s: Sandbox = FakeSandbox()
    handle = await s.create(SandboxSpec(nickname="dev", image="chatop-base"))
    assert handle.nickname == "dev"
    assert handle.id in s.live
    await s.destroy(handle.id)
    assert handle.id not in s.live


def test_sandbox_spec_forbids_docker_socket_mount():
    # Hard security rule (§10.4-S1 / R4): socket must never be mounted into the sandbox.
    with pytest.raises(ValueError):
        SandboxSpec(nickname="x", image="i", mounts=["/var/run/docker.sock:/var/run/docker.sock"])

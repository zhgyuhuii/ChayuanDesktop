import pytest

from chacmd.interfaces.registry import (
    ConfigSource,
    InProcessConfigSource,
    InProcessServiceRegistry,
    ServiceInstance,
    ServiceRegistry,
)


@pytest.mark.asyncio
async def test_register_and_resolve_by_service_name_not_ip():
    reg: ServiceRegistry = InProcessServiceRegistry()
    await reg.register(ServiceInstance(name="chacmd-orchestrator", handle="session-abc", meta={"role": "core"}))
    found = await reg.resolve("chacmd-orchestrator")
    assert found[0].handle == "session-abc"
    assert "ip" not in found[0].meta  # handle is a logical session, never an IP


@pytest.mark.asyncio
async def test_deregister_removes_instance():
    reg = InProcessServiceRegistry()
    await reg.register(ServiceInstance(name="svc", handle="h1", meta={}))
    await reg.deregister("svc", "h1")
    assert await reg.resolve("svc") == []


def test_config_source_get_default():
    cfg: ConfigSource = InProcessConfigSource({"chayuan.base_url": "http://127.0.0.1:8000"})
    assert cfg.get("chayuan.base_url") == "http://127.0.0.1:8000"
    assert cfg.get("missing", "fallback") == "fallback"

"""#10 统一配置中心（CRUD + to_env 下发 + 热更新事件）。"""

import pytest

from chacmd.interfaces.eventbus import InMemoryEventBus
from chacmd.orchestrator.config_center import AgentConfig, ConfigCenter


def test_crud():
    cc = ConfigCenter()
    cfg = AgentConfig(model="deepseek", api_key="k", base_url="http://gw")
    cc.set("dev", cfg)
    assert cc.get("dev") == cfg
    cc.delete("dev")
    assert cc.get("dev") is None


def test_to_env_maps_config():
    cc = ConfigCenter()
    cc.set("dev", AgentConfig(model="qwen", api_key="sk-1", base_url="http://gw", extra={"TEMP": "0.2"}))
    env = cc.to_env("dev")
    assert env["CHACMD_MODEL"] == "qwen"
    assert env["OPENAI_API_KEY"] == "sk-1"
    assert env["OPENAI_BASE_URL"] == "http://gw"
    assert env["TEMP"] == "0.2"


def test_to_env_missing_returns_empty():
    assert ConfigCenter().to_env("ghost") == {}


@pytest.mark.asyncio
async def test_hot_update_publishes_event():
    bus = InMemoryEventBus()
    cc = ConfigCenter(bus=bus)
    sub = bus.subscribe("agent.dev.config")

    import asyncio

    fut = asyncio.ensure_future(sub.__anext__())
    await asyncio.sleep(0)
    await cc.hot_update("dev", AgentConfig(model="m2", api_key="k2", base_url="http://gw2"))
    msg = await asyncio.wait_for(fut, timeout=1.0)
    assert msg["nickname"] == "dev"
    assert msg["env"]["CHACMD_MODEL"] == "m2"
    # 且配置已更新
    assert cc.get("dev").model == "m2"

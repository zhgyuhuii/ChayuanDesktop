import pytest

from chacmd.domain.events import Event
from chacmd.interfaces.agent_adapter import AgentAdapter, DispatchSpec, FakeAgentAdapter


@pytest.mark.asyncio
async def test_fake_adapter_streams_events_then_result():
    a: AgentAdapter = FakeAgentAdapter(steps=["step-1", "step-2"])
    spec = DispatchSpec(job_id="j1", task_id="t1", nickname="dev", goal="build app", system_prompt="you are dev")
    events = [e async for e in a.dispatch(spec)]
    kinds = [e.kind for e in events]
    assert kinds == ["started", "progress", "progress", "succeeded"]
    assert all(isinstance(e, Event) for e in events)
    assert events[-1].payload["result"] == "ok"


def test_adapter_manifest_declares_capabilities():
    a = FakeAgentAdapter(steps=[])
    assert a.manifest()["name"] == "fake"
    assert "stream" in a.manifest()["capabilities"]

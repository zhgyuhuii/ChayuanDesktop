import pytest

from chacmd.interfaces.transport import InProcessTransport, LogicalAddress


def test_logical_address_rejects_ip_like_targets():
    with pytest.raises(ValueError):
        LogicalAddress.nickname("10.0.0.5")  # looks like an IP → forbidden
    ok = LogicalAddress.nickname("radar-analyst")
    assert ok.kind == "nickname"
    assert ok.value == "radar-analyst"


def test_subject_and_volume_addresses():
    assert LogicalAddress.subject("agent.pm.inbox").value == "agent.pm.inbox"
    assert LogicalAddress.volume("job-123").value == "/workspace/job-123"


@pytest.mark.asyncio
async def test_inprocess_transport_delivers_by_logical_name_not_ip():
    t = InProcessTransport()
    received = []
    await t.bind(LogicalAddress.nickname("worker-1"), received.append)
    await t.send(LogicalAddress.nickname("worker-1"), {"hello": "world"})
    assert received == [{"hello": "world"}]

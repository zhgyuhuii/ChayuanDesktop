import asyncio

import pytest

from chacmd.api.stream import EventStreamHub, sse_format


def test_sse_format_is_eventsource_frame():
    assert sse_format({"kind": "started", "seq": 0}) == 'data: {"kind": "started", "seq": 0}\n\n'


@pytest.mark.asyncio
async def test_broadcast_fans_out_to_all_subscribers():
    hub = EventStreamHub()
    a = hub.register()
    b = hub.register()
    await hub.broadcast({"kind": "x"})
    assert await asyncio.wait_for(a.get(), 1) == {"kind": "x"}
    assert await asyncio.wait_for(b.get(), 1) == {"kind": "x"}
    hub.unregister(a)
    hub.unregister(b)


@pytest.mark.asyncio
async def test_unregister_stops_delivery():
    hub = EventStreamHub()
    q = hub.register()
    hub.unregister(q)
    await hub.broadcast({"kind": "y"})  # 无订阅者，不应抛
    assert q.empty()


@pytest.mark.asyncio
async def test_full_subscriber_queue_drops_not_blocks():
    # 慢消费者队列满时丢弃最旧，不阻塞广播（背压保护）
    hub = EventStreamHub(maxsize=1)
    q = hub.register()
    await hub.broadcast({"n": 1})
    await hub.broadcast({"n": 2})  # 队列满，丢最旧，不阻塞
    assert await asyncio.wait_for(q.get(), 1) == {"n": 2}

import asyncio

import pytest

from chacmd.interfaces.eventbus import EventBus, InMemoryEventBus


@pytest.mark.asyncio
async def test_inmemory_bus_publish_subscribe_by_subject():
    bus: EventBus = InMemoryEventBus()
    got = []

    async def consume():
        async for msg in bus.subscribe("job.j1.progress"):
            got.append(msg)
            if len(got) == 2:
                return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)  # let subscriber attach
    await bus.publish("job.j1.progress", {"seq": 1})
    await bus.publish("job.j1.progress", {"seq": 2})
    await asyncio.wait_for(task, timeout=1)
    assert [m["seq"] for m in got] == [1, 2]


@pytest.mark.asyncio
async def test_subject_isolation():
    bus = InMemoryEventBus()
    got = []

    async def consume():
        async for msg in bus.subscribe("job.j1.progress"):
            got.append(msg)
            return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)
    await bus.publish("job.OTHER.progress", {"seq": 9})  # different subject → ignored
    await bus.publish("job.j1.progress", {"seq": 1})
    await asyncio.wait_for(task, timeout=1)
    assert got == [{"seq": 1}]

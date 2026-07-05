import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from chacmd.api.app import create_app
from chacmd.api.stream import EventStreamHub, stream_events
from chacmd.interfaces.db import Database


@pytest.mark.asyncio
async def test_stream_events_yields_sse_frame_on_broadcast():
    # 直接测流式生成器（绕开 ASGITransport 对无限流的缓冲）。
    # 生成器首次 __anext__ 才 register()，故先把它起成 task 让其注册，再 broadcast。
    hub = EventStreamHub()
    gen = stream_events(hub)
    fut = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)  # 让生成器跑到 register() + 阻塞在 q.get()
    assert hub._subscribers  # 已注册
    await hub.broadcast({"kind": "started", "job_id": "j1"})
    frame = await asyncio.wait_for(fut, 1)
    assert frame.startswith("data: ")
    assert '"kind": "started"' in frame
    assert frame.endswith("\n\n")
    await gen.aclose()  # 触发 finally 注销队列
    assert not hub._subscribers


@pytest.mark.asyncio
async def test_stream_route_registered_when_hub_injected():
    db = Database(url="sqlite+aiosqlite:///:memory:")
    await db.create_all()
    app = create_app(db, stream_hub=EventStreamHub())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        spec = (await c.get("/openapi.json")).json()
    assert "/api/v1/stream" in spec["paths"]
    await db.dispose()


@pytest.mark.asyncio
async def test_stream_absent_when_hub_not_injected():
    db = Database(url="sqlite+aiosqlite:///:memory:")
    await db.create_all()
    app = create_app(db)  # 无 hub
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/api/v1/stream")
    assert r.status_code == 404
    await db.dispose()

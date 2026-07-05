import asyncio
import json

import pytest
import websockets

from chacmd.domain.repository import ContainerRepository
from chacmd.gateway.bridge_gateway import BridgeGateway
from chacmd.interfaces.db import Database


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


@pytest.mark.asyncio
async def test_container_reverse_connects_and_registers(db):
    gw = BridgeGateway(ContainerRepository(db), host="127.0.0.1", port=8767)
    await gw.start()
    try:
        async with websockets.connect("ws://127.0.0.1:8767/bridge") as ws:
            await ws.send(json.dumps({"type": "register", "nickname": "dev", "dept": "d1", "data": {}}))
            await asyncio.sleep(0.1)
            row = await ContainerRepository(db).resolve("dev")
            assert row is not None and row.session  # session recorded, no IP used
    finally:
        await gw.stop()

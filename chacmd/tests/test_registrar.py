import pytest

from chacmd.domain.repository import ContainerRepository
from chacmd.gateway.protocol import Envelope
from chacmd.interfaces.db import Database
from chacmd.orchestrator.registrar import Registrar


@pytest.fixture
async def db():
    d = Database(url="sqlite+aiosqlite:///:memory:")
    await d.create_all()
    yield d
    await d.dispose()


@pytest.mark.asyncio
async def test_register_message_records_nickname_session(db):
    reg = Registrar(ContainerRepository(db))
    env = Envelope(type="register", nickname="dev", dept="d1", data={})
    await reg.handle(env, session="sess-1")
    row = await ContainerRepository(db).resolve("dev")
    assert row.session == "sess-1"


@pytest.mark.asyncio
async def test_heartbeat_updates_lease(db):
    reg = Registrar(ContainerRepository(db))
    await reg.handle(Envelope(type="register", nickname="dev", dept="d1", data={}), session="s1")
    before = (await ContainerRepository(db).resolve("dev")).last_heartbeat
    await reg.handle(Envelope(type="heartbeat", nickname="dev", dept="d1", data={}), session="s1")
    after = (await ContainerRepository(db).resolve("dev")).last_heartbeat
    assert after >= before


def test_envelope_rejects_unknown_type():
    with pytest.raises(ValueError):
        Envelope(type="bogus", nickname="x", dept="d", data={})

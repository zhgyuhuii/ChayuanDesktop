import pytest

from chacmd.config import Settings
from chacmd.container import build_container


@pytest.mark.asyncio
async def test_container_wires_default_impls_and_is_swappable():
    settings = Settings(db_url="sqlite+aiosqlite:///:memory:", chayuan_base_url="http://x", chayuan_web_url="http://w")
    c = await build_container(settings, use_fakes=True)
    # I1..I10 present:
    assert c.chayuan is not None       # I1
    assert c.db.dialect == "sqlite"    # I2
    assert c.crypto is not None        # I3
    assert c.registry is not None      # I4
    assert c.bus is not None           # I6
    assert c.transport is not None     # I10
    assert c.adapter is not None       # I5
    assert c.sandbox is not None       # I7
    assert c.auth is not None          # I8
    await c.db.dispose()


@pytest.mark.asyncio
async def test_swap_config_source_without_changing_callers():
    # Prove I4 swap-point: replace ConfigSource impl, callers unaffected.
    from chacmd.interfaces.registry import InProcessConfigSource
    settings = Settings(db_url="sqlite+aiosqlite:///:memory:", chayuan_base_url="http://x", chayuan_web_url="http://w")
    c = await build_container(settings, use_fakes=True)
    c.config = InProcessConfigSource({"k": "v2"})
    assert c.config.get("k") == "v2"
    await c.db.dispose()

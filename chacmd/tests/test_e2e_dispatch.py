import asyncio

import pytest

from chacmd.config import Settings
from chacmd.container import build_container
from chacmd.domain.state import JobState


@pytest.mark.asyncio
async def test_full_loop_dispatch_stream_persist_volume(tmp_path):
    settings = Settings(
        db_url="sqlite+aiosqlite:///:memory:",
        chayuan_base_url="http://x", chayuan_web_url="http://w",
        workspace_root=str(tmp_path),
    )
    c = await build_container(settings, use_fakes=True)

    # A container comes online (reverse-registered).
    await c.containers.upsert(nickname="dev", session="s1", dept="d1")

    # Create a job by code and prepare its volume.
    job = await c.jobs.create(code="world-rank-app", goal="build ranking app", dept="d1")
    c.workspace.ensure_job_dir(job_id=job.id, code="world-rank-app")

    # Subscribe to the success subject BEFORE dispatch.
    seen = []
    async def watch():
        async for m in c.bus.subscribe(f"job.{job.id}.succeeded"):
            seen.append(m)
            return
    watcher = asyncio.create_task(watch())
    await asyncio.sleep(0)

    # Dispatch by nickname.
    await c.dispatcher.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="you are dev")
    await asyncio.wait_for(watcher, timeout=2)

    # Assert: state succeeded, audit trail present, we can mark the produce done atomically.
    assert (await c.jobs.get(job.id)).state == JobState.SUCCEEDED.value
    audit = await c.audit.list_for_job(job.id)
    assert [a.kind for a in audit][0] == "started"
    assert [a.kind for a in audit][-1] == "succeeded"
    c.workspace.mark_done(job.id, "world-rank-app", {"artifact": "output/app"})
    assert c.workspace.is_done(job.id, "world-rank-app") is True

    await c.db.dispose()

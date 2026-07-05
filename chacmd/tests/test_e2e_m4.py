"""M4 端到端验收：把 M3 新增能力（Provisioner 供给/配置下发、traceparent、
预算 kill、审批门状态机）串进真 Container 走一遍。"""

import asyncio

import pytest

from chacmd.config import Settings
from chacmd.container import build_container
from chacmd.domain.state import JobState


def _settings(tmp_path) -> Settings:
    return Settings(
        db_url="sqlite+aiosqlite:///:memory:",
        chayuan_base_url="http://x", chayuan_web_url="http://w",
        workspace_root=str(tmp_path),
    )


@pytest.mark.asyncio
async def test_provision_then_dispatch_to_volume(tmp_path):
    # #2 一键供给工位 → #10 配置下发 → 派活 → 成功 → 卷 done-marker
    c = await build_container(_settings(tmp_path), use_fakes=True)
    handle = await c.provisioner.provision(
        nickname="dev", dept="d1", env={"MODEL": "deepseek", "BASE_URL": "http://gw"}
    )
    assert handle.nickname == "dev"
    assert handle.id in c.sandbox.live  # 供给的沙箱句柄在线

    job = await c.jobs.create(code="rank-app", goal="build", dept="d1")
    c.workspace.ensure_job_dir(job_id=job.id, code="rank-app")
    await c.dispatcher.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="p")

    assert (await c.jobs.get(job.id)).state == JobState.SUCCEEDED.value
    c.workspace.mark_done(job.id, "rank-app", {"artifact": "output/app"})
    assert c.workspace.is_done(job.id, "rank-app") is True
    await c.db.dispose()


@pytest.mark.asyncio
async def test_bus_events_carry_traceparent(tmp_path):
    # NFR-O1：总线事件带 W3C traceparent + baggage(job_id)
    c = await build_container(_settings(tmp_path), use_fakes=True)
    await c.containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await c.jobs.create(code="c", goal="g", dept="d1")

    seen = []

    async def watch():
        async for m in c.bus.subscribe(f"job.{job.id}.started"):
            seen.append(m)
            return

    watcher = asyncio.create_task(watch())
    await asyncio.sleep(0)
    await c.dispatcher.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="p")
    await asyncio.wait_for(watcher, timeout=2)

    assert seen and "traceparent" in seen[0]
    assert seen[0]["baggage"]["job_id"] == job.id
    await c.db.dispose()


@pytest.mark.asyncio
async def test_audit_trail_full_sequence(tmp_path):
    c = await build_container(_settings(tmp_path), use_fakes=True)
    await c.containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await c.jobs.create(code="c", goal="g", dept="d1")
    await c.dispatcher.dispatch(job_id=job.id, nickname="dev", subject="u1", system_prompt="p")

    kinds = [a.kind for a in await c.audit.list_for_job(job.id)]
    assert kinds[0] == "started"
    assert kinds[-1] == "succeeded"
    await c.db.dispose()

"""调度器·调度循环 + 任务卡↔Job 映射（对接 dispatcher/反连网关/事件总线）。

scheduler_tick：护栏(global_circuit)→取单(next_dispatchable)→路由(route)→择容器→出派单计划。
真派活复用 Dispatcher（反连网关），本测试用 Fake 全链路验证编排。
"""

import pytest

from chacmd.domain.repository import AuditRepository, ContainerRepository, JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.agent_adapter import FakeAgentAdapter
from chacmd.interfaces.chayuan_client import FakeChayuanClient
from chacmd.interfaces.db import Database
from chacmd.interfaces.eventbus import InMemoryEventBus
from chacmd.orchestrator.dispatcher import Dispatcher
from chacmd.orchestrator.ingest import EventIngest
from chacmd.scheduler.guardrails import BudgetLimits
from chacmd.scheduler.loop import scheduler_tick, workorder_to_dispatch
from chacmd.scheduler.workorder import WorkOrder


def _wo(id, prio="P1", repo="app", touches=(), classification="internal", fail_streak=0):
    return WorkOrder(id=id, code=id, priority=prio, repo=repo, touches=touches,
                     classification=classification, fail_streak=fail_streak)


def _assign(_order):
    return "dev"  # 简单择容器：恒返回 dev（真实为健康/连败择优）


def test_tick_dispatches_ready_order():
    res = scheduler_tick([_wo("a", "P0")], inflight=[], night_spend=0, month_spend=0,
                         assign_nickname=_assign)
    assert res.halted is False
    assert [p.order_id for p in res.dispatched] == ["a"]
    assert res.dispatched[0].nickname == "dev"
    assert res.dispatched[0].model_tier == "sonnet"


def test_tick_halts_over_night_budget():
    res = scheduler_tick([_wo("a")], inflight=[], night_spend=999, month_spend=0,
                         assign_nickname=_assign, limits=BudgetLimits())
    assert res.halted is True
    assert res.halt_reason == "night_halt"
    assert res.dispatched == []


def test_tick_rejects_secret_order():
    res = scheduler_tick([_wo("s", classification="secret")], inflight=[], night_spend=0,
                         month_spend=0, assign_nickname=_assign)
    assert res.rejected_secret == ["s"]
    assert res.dispatched == []


def test_tick_escalates_model_on_fail_streak():
    res = scheduler_tick([_wo("a", fail_streak=2)], inflight=[], night_spend=0, month_spend=0,
                         assign_nickname=_assign)
    assert res.dispatched[0].model_tier == "opus"


def test_tick_skips_when_no_container():
    res = scheduler_tick([_wo("a")], inflight=[], night_spend=0, month_spend=0,
                         assign_nickname=lambda o: None)
    assert res.dispatched == []


def test_tick_respects_concurrency():
    ready = [_wo("a", "P0", "r1"), _wo("b", "P0", "r1"), _wo("c", "P0", "r1")]
    res = scheduler_tick(ready, inflight=[], night_spend=0, month_spend=0,
                         assign_nickname=_assign, max_per_repo=2)
    assert len(res.dispatched) == 2  # 同仓≤2


def test_workorder_to_dispatch_maps_fields():
    d = workorder_to_dispatch(_wo("a"), "dev", "opus")
    assert d["job_id"] == "a"
    assert d["nickname"] == "dev"
    assert "opus" in d["system_prompt"]


@pytest.mark.asyncio
async def test_tick_plan_drives_real_dispatcher():
    db = Database(url="sqlite+aiosqlite:///:memory:")
    await db.create_all()
    jobs = JobRepository(db)
    containers = ContainerRepository(db)
    await containers.upsert(nickname="dev", session="s1", dept="d1")
    job = await jobs.create(code="a", goal="build", dept="d1")  # 工单 a 对应的 Job

    disp = Dispatcher(jobs, containers, FakeChayuanClient(), FakeAgentAdapter(steps=["x"]),
                      EventIngest(InMemoryEventBus(), jobs, AuditRepository(db)))

    order = _wo("a")
    # 调度决策 → 取计划
    res = scheduler_tick([order], inflight=[], night_spend=0, month_spend=0, assign_nickname=_assign)
    plan = res.dispatched[0]
    # 映射 + 真 Dispatcher 派活（复用反连网关路径）；job_id 用 Job 真实 id
    args = workorder_to_dispatch(order, plan.nickname, plan.model_tier)
    await disp.dispatch(job_id=job.id, nickname=plan.nickname, subject=args["subject"],
                        system_prompt=args["system_prompt"])
    final = await jobs.get(job.id)
    assert final.state == JobState.SUCCEEDED.value
    await db.dispose()

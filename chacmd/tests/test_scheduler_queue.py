"""调度器·ready 队列 + 优先级取单 + 并发/互斥锁（work-model 场景推演·调度派单）。

Temporal/循环每 60s 扫 ready 队列按优先级取单；同仓并发≤2、模块 touches 互斥、目标健康。
"""

from chacmd.scheduler.queue import next_dispatchable
from chacmd.scheduler.workorder import WorkOrder, WorkOrderState


def _wo(id, prio, repo, touches=(), state=WorkOrderState.READY):
    return WorkOrder(id=id, code=id, priority=prio, repo=repo, touches=touches, state=state)


def test_priority_order_p0_first():
    ready = [_wo("a", "P3", "r1"), _wo("b", "P0", "r2"), _wo("c", "P1", "r3")]
    picked = next_dispatchable(ready, inflight=[])
    assert [o.id for o in picked] == ["b", "c", "a"]


def test_same_repo_concurrency_cap():
    ready = [_wo("a", "P0", "r1"), _wo("b", "P0", "r1"), _wo("c", "P0", "r1")]
    picked = next_dispatchable(ready, inflight=[], max_per_repo=2)
    assert len(picked) == 2  # 同仓最多 2


def test_inflight_repo_counts_toward_cap():
    ready = [_wo("a", "P0", "r1"), _wo("b", "P0", "r1")]
    inflight = [_wo("x", "P0", "r1", state=WorkOrderState.IN_PROGRESS)]
    picked = next_dispatchable(ready, inflight, max_per_repo=2)
    assert len(picked) == 1  # 已有 1 在途 → 只能再派 1


def test_module_mutex_against_inflight():
    ready = [_wo("a", "P0", "r1", touches=("auth",))]
    inflight = [_wo("x", "P0", "r2", touches=("auth",), state=WorkOrderState.IN_PROGRESS)]
    assert next_dispatchable(ready, inflight) == []  # auth 被在途单占用


def test_module_mutex_among_ready_picks_higher_priority():
    ready = [
        _wo("low", "P2", "r1", touches=("core",)),
        _wo("high", "P0", "r2", touches=("core",)),
    ]
    picked = next_dispatchable(ready, inflight=[])
    assert [o.id for o in picked] == ["high"]  # core 互斥，取高优先


def test_non_conflicting_all_dispatchable():
    ready = [_wo("a", "P0", "r1", touches=("m1",)), _wo("b", "P1", "r2", touches=("m2",))]
    picked = next_dispatchable(ready, inflight=[])
    assert {o.id for o in picked} == {"a", "b"}

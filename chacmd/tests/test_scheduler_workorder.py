"""调度器·九步工单状态机（work-model 主文档第四章）。

九步：ready→assigned→in_progress→ci_passed→reviewed→merged→staging→canary→released；
失败任一环回炉(→in_progress，上限3轮)或等人(blocked)。工单=GitLab Issue，标签驱动。
"""

import pytest

from chacmd.scheduler.workorder import (
    WorkOrder,
    WorkOrderState,
    can_transition,
    transition,
)


def test_nine_step_happy_path():
    chain = [
        WorkOrderState.READY,
        WorkOrderState.ASSIGNED,
        WorkOrderState.IN_PROGRESS,
        WorkOrderState.CI_PASSED,
        WorkOrderState.REVIEWED,
        WorkOrderState.MERGED,
        WorkOrderState.STAGING,
        WorkOrderState.CANARY,
        WorkOrderState.RELEASED,
    ]
    assert len(chain) == 9
    for a, b in zip(chain, chain[1:], strict=True):
        assert can_transition(a, b), f"{a}->{b} 应合法"


def test_ci_fail_recycles_to_in_progress():
    # CI 未过 = 回炉
    assert can_transition(WorkOrderState.IN_PROGRESS, WorkOrderState.IN_PROGRESS)  # 回炉自转
    # 评审打回 → 回 in_progress
    assert can_transition(WorkOrderState.CI_PASSED, WorkOrderState.IN_PROGRESS)


def test_block_for_human_anywhere_reasonable():
    assert can_transition(WorkOrderState.IN_PROGRESS, WorkOrderState.BLOCKED)
    assert can_transition(WorkOrderState.BLOCKED, WorkOrderState.IN_PROGRESS)  # 人解阻
    assert can_transition(WorkOrderState.BLOCKED, WorkOrderState.CANCELLED)


def test_released_is_terminal():
    assert not can_transition(WorkOrderState.RELEASED, WorkOrderState.STAGING)
    with pytest.raises(ValueError):
        transition(WorkOrderState.RELEASED, WorkOrderState.READY)


def test_illegal_skip_rejected():
    # 不能从 ready 直接跳到 merged
    assert not can_transition(WorkOrderState.READY, WorkOrderState.MERGED)


def test_workorder_defaults():
    wo = WorkOrder(id="w1", code="login", priority="P1", repo="app", touches=("auth",))
    assert wo.state == WorkOrderState.READY
    assert wo.retries == 0
    assert wo.classification == "internal"

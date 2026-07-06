"""调度器·工单模型 + 九步状态机（work-model 主文档第四章）。

工单 = GitLab Issue，状态用标签驱动，调度器与 CI webhook 推动流转。
九步：ready→assigned→in_progress→ci_passed→reviewed→merged→staging→canary→released。
失败：回炉(→in_progress，上限 3 轮)或等人(blocked)；blocked 可解阻回 in_progress 或取消。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class WorkOrderState(StrEnum):
    READY = "ready"  # 建单
    ASSIGNED = "assigned"  # 派单
    IN_PROGRESS = "in_progress"  # 开发（回炉也回这里）
    CI_PASSED = "ci_passed"  # CI 通过
    REVIEWED = "reviewed"  # 交叉评审通过
    MERGED = "merged"  # 裁决合并
    STAGING = "staging"  # 发布预发
    CANARY = "canary"  # 灰度
    RELEASED = "released"  # 发布完成（终态）
    BLOCKED = "blocked"  # 等人
    CANCELLED = "cancelled"  # 取消（终态）


_ALLOWED: dict[WorkOrderState, set[WorkOrderState]] = {
    WorkOrderState.READY: {WorkOrderState.ASSIGNED, WorkOrderState.CANCELLED},
    WorkOrderState.ASSIGNED: {WorkOrderState.IN_PROGRESS, WorkOrderState.BLOCKED, WorkOrderState.CANCELLED},
    WorkOrderState.IN_PROGRESS: {
        WorkOrderState.CI_PASSED,
        WorkOrderState.IN_PROGRESS,  # 回炉（CI 未过带日志重做）
        WorkOrderState.BLOCKED,
        WorkOrderState.CANCELLED,
    },
    WorkOrderState.CI_PASSED: {
        WorkOrderState.REVIEWED,
        WorkOrderState.IN_PROGRESS,  # 评审打回=回炉
        WorkOrderState.BLOCKED,
    },
    WorkOrderState.REVIEWED: {WorkOrderState.MERGED, WorkOrderState.IN_PROGRESS, WorkOrderState.BLOCKED},
    WorkOrderState.MERGED: {WorkOrderState.STAGING, WorkOrderState.BLOCKED},
    WorkOrderState.STAGING: {WorkOrderState.CANARY, WorkOrderState.BLOCKED},
    WorkOrderState.CANARY: {WorkOrderState.RELEASED, WorkOrderState.BLOCKED},
    WorkOrderState.RELEASED: set(),
    WorkOrderState.BLOCKED: {WorkOrderState.IN_PROGRESS, WorkOrderState.CANCELLED},
    WorkOrderState.CANCELLED: set(),
}


def can_transition(src: WorkOrderState, dst: WorkOrderState) -> bool:
    return dst in _ALLOWED[src]


def transition(src: WorkOrderState, dst: WorkOrderState) -> WorkOrderState:
    if not can_transition(src, dst):
        raise ValueError(f"illegal workorder transition {src} -> {dst}")
    return dst


@dataclass
class WorkOrder:
    id: str
    code: str
    priority: str  # P0 | P1 | P2 | P3
    repo: str
    touches: tuple[str, ...] = ()
    classification: str = "internal"  # internal | secret
    state: WorkOrderState = WorkOrderState.READY
    retries: int = 0
    fail_streak: int = 0  # 连败计数（模型升档/容器隔离用）


__all__ = ["WorkOrderState", "WorkOrder", "can_transition", "transition"]

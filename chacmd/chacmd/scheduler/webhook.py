"""调度器·CI/GitLab webhook 事件源接入（纯逻辑）。

把 GitLab/CI webhook 归一化成规范事件，再驱动九步工单状态机流转。
非法/未知事件保持原状（幂等，防重放/乱序打崩状态）。
"""

from __future__ import annotations

from chacmd.scheduler.workorder import WorkOrderState, can_transition, transition

# 规范事件 → 目标状态
_EVENT_TARGET: dict[str, WorkOrderState] = {
    "ci_passed": WorkOrderState.CI_PASSED,
    "ci_failed": WorkOrderState.IN_PROGRESS,  # 回炉
    "review_approved": WorkOrderState.REVIEWED,
    "review_rejected": WorkOrderState.IN_PROGRESS,  # 打回=回炉
    "merged": WorkOrderState.MERGED,
    "staged": WorkOrderState.STAGING,
    "canary": WorkOrderState.CANARY,
    "released": WorkOrderState.RELEASED,
}


def normalize_gitlab(payload: dict) -> str | None:
    """GitLab webhook → 规范事件；不认识返回 None。"""
    kind = payload.get("object_kind")
    attrs = payload.get("object_attributes", {}) or {}
    if kind == "pipeline":
        status = attrs.get("status")
        if status == "success":
            return "ci_passed"
        if status == "failed":
            return "ci_failed"
        return None
    if kind == "merge_request":
        action = attrs.get("action")
        if action == "approve":
            return "review_approved"
        if action == "merge":
            return "merged"
        return None
    return None


def apply_event(state: WorkOrderState, event_kind: str) -> WorkOrderState:
    """按事件推动状态；非法转移/未知事件保持原状（幂等）。"""
    target = _EVENT_TARGET.get(event_kind)
    if target is None:
        return state
    if not can_transition(state, target):
        return state
    return transition(state, target)


__all__ = ["normalize_gitlab", "apply_event"]

"""调度器·调度循环 + 任务卡↔Job 映射（对接层）。

一次 tick 的编排决策（纯逻辑，IO 注入）：
  护栏 global_circuit → 取单 next_dispatchable → 路由 route（涉密拦截/模型分层）
  → 择容器 assign_nickname → 产出派单计划。
真派活复用 chacmd 现有 Dispatcher（经反连网关下发到数字员工容器），loop 只做决策。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from chacmd.scheduler.guardrails import BudgetLimits, global_circuit
from chacmd.scheduler.queue import next_dispatchable
from chacmd.scheduler.routing import route
from chacmd.scheduler.workorder import WorkOrder


@dataclass(frozen=True)
class DispatchPlan:
    order_id: str
    nickname: str
    model_tier: str
    gateway: str


@dataclass(frozen=True)
class TickResult:
    dispatched: list[DispatchPlan]
    halted: bool
    halt_reason: str | None
    rejected_secret: list[str]


def scheduler_tick(
    ready: Iterable[WorkOrder],
    inflight: Iterable[WorkOrder],
    night_spend: float,
    month_spend: float,
    assign_nickname: Callable[[WorkOrder], str | None],
    *,
    limits: BudgetLimits | None = None,
    max_per_repo: int = 2,
) -> TickResult:
    limits = limits or BudgetLimits()
    circuit = global_circuit(night_spend, month_spend, limits)
    if not circuit.allow_dispatch:
        return TickResult([], True, circuit.reason, [])

    candidates = next_dispatchable(ready, inflight, max_per_repo)
    dispatched: list[DispatchPlan] = []
    rejected: list[str] = []
    for o in candidates:
        r = route(o.classification, o.fail_streak)
        if not r.dispatchable:
            rejected.append(o.id)  # 涉密单 DMZ 不派
            continue
        nickname = assign_nickname(o)
        if nickname is None:
            continue  # 无可用健康容器
        dispatched.append(DispatchPlan(o.id, nickname, r.model_tier, r.gateway))
    return TickResult(dispatched, False, None, rejected)


def workorder_to_dispatch(order: WorkOrder, nickname: str, model_tier: str) -> dict:
    """任务卡 → Dispatcher.dispatch 参数（任务卡↔Job 映射）。"""
    return {
        "job_id": order.id,
        "nickname": nickname,
        "subject": "scheduler",
        "system_prompt": f"目标：{order.code}；模型档位：{model_tier}",
    }


__all__ = ["DispatchPlan", "TickResult", "scheduler_tick", "workorder_to_dispatch"]

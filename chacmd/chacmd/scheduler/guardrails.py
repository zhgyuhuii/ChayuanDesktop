"""调度器·成本护栏（纯逻辑，work-model 主文档 模型预算三级熔断）。

三级硬编码熔断（阈值可配）：
- 单任务 $8 → 挂起该任务（不停全局）。
- 单晚 $200 → 停止派单（全局）。
- 月度触顶 → 暂停并上报（最严）。
外加：回炉重试（上限 3 轮，超则等人）、连败容器隔离。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BudgetLimits:
    per_task: float = 8.0
    per_night: float = 200.0
    per_month: float = 5000.0


@dataclass(frozen=True)
class CircuitDecision:
    allow_dispatch: bool
    reason: str | None  # None | "night_halt" | "month_cap"


def task_over_budget(task_spend: float, limits: BudgetLimits) -> bool:
    """单任务超 $8 → 挂起该任务。"""
    return task_spend >= limits.per_task


def global_circuit(night_spend: float, month_spend: float, limits: BudgetLimits) -> CircuitDecision:
    """全局派单熔断：月度触顶最严，其次单晚 $200。"""
    if month_spend >= limits.per_month:
        return CircuitDecision(False, "month_cap")
    if night_spend >= limits.per_night:
        return CircuitDecision(False, "night_halt")
    return CircuitDecision(True, None)


def recycle_or_block(retries: int, max_retries: int = 3) -> str:
    """失败后：未达上限回炉（保留上下文重做），达上限则等人。"""
    return "recycle" if retries < max_retries else "block"


def should_isolate(fail_streak: int, threshold: int = 3) -> bool:
    """连败达阈值 → 容器隔离出可用池。"""
    return fail_streak >= threshold


__all__ = [
    "BudgetLimits",
    "CircuitDecision",
    "task_over_budget",
    "global_circuit",
    "recycle_or_block",
    "should_isolate",
]

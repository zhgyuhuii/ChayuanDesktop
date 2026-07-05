"""#13 容灾 reconcile 决策 + leader/lease 单活（纯逻辑）。

决策层与执行/IO 解耦：给定期望态 vs 实况（谁活/谁死）+ 在途任务，算出重建/中断动作列表；
真正起容器/改派由上层带 Docker 执行（本层不碰 IO，便于 Fake 时钟单测）。
reconcile 必须 leader 单活（NFR-S2），否则多实例会重复拉替身。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class DesiredContainer:
    nickname: str
    role: str


@dataclass(frozen=True)
class ReconcileAction:
    kind: str  # "rebuild" | "interrupt_task"
    target: str  # nickname 或 task_id
    detail: dict


@dataclass(frozen=True)
class LeaderLease:
    holder: str | None = None
    expires_at: float = 0.0


def reconcile(
    desired: Iterable[DesiredContainer],
    alive: set[str],
    dead: set[str],
    inflight: Mapping[str, str],
) -> list[ReconcileAction]:
    """期望态 vs 实况 → 动作列表：死容器重建 + 其在途任务中断。"""
    actions: list[ReconcileAction] = []
    for d in desired:
        if d.nickname in dead:
            actions.append(ReconcileAction("rebuild", d.nickname, {"role": d.role}))
    # 死容器上的在途任务判 interrupted（NFR-R1 承认至少一次 + 去重）。
    for task_id, nickname in inflight.items():
        if nickname in dead:
            actions.append(ReconcileAction("interrupt_task", task_id, {"was_on": nickname}))
    return actions


def try_acquire(
    lease: LeaderLease, candidate: str, now: float, ttl: float
) -> tuple[LeaderLease, bool]:
    """尝试获取/续租 leader 租约。空闲或过期→candidate 拿；本人→续租；他人持有→拒。"""
    if lease.holder is None or now >= lease.expires_at or lease.holder == candidate:
        return LeaderLease(candidate, now + ttl), True
    return lease, False


def is_leader(lease: LeaderLease, candidate: str, now: float) -> bool:
    return lease.holder == candidate and now < lease.expires_at


def reconcile_if_leader(
    lease: LeaderLease,
    candidate: str,
    now: float,
    desired: Iterable[DesiredContainer],
    alive: set[str],
    dead: set[str],
    inflight: Mapping[str, str],
) -> list[ReconcileAction]:
    """仅当 candidate 是有效 leader 才产出动作，否则空（NFR-S2 单活）。"""
    if not is_leader(lease, candidate, now):
        return []
    return reconcile(desired, alive, dead, inflight)


__all__ = [
    "DesiredContainer",
    "ReconcileAction",
    "LeaderLease",
    "reconcile",
    "try_acquire",
    "is_leader",
    "reconcile_if_leader",
]

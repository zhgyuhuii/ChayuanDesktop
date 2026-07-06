"""调度器·ready 队列取单（纯逻辑）。

按优先级 P0>P1>P2>P3 取单，跳过违反约束者：
- 并发：同仓库在途 ≤ max_per_repo（默认 2）。
- 互斥：模块 touches 与任一在途/本轮已选单相交 → 跳过（同模块不并改）。

互斥/并发对"在途 inflight + 本轮已选"同时计数，避免同一轮选出两张冲突单。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from chacmd.scheduler.workorder import WorkOrder

_PRIO = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def next_dispatchable(
    ready: Iterable[WorkOrder],
    inflight: Iterable[WorkOrder],
    max_per_repo: int = 2,
) -> list[WorkOrder]:
    inflight = list(inflight)
    repo_count: Counter[str] = Counter(o.repo for o in inflight)
    locked: set[str] = {m for o in inflight for m in o.touches}

    picked: list[WorkOrder] = []
    for o in sorted(ready, key=lambda x: _PRIO.get(x.priority, 9)):
        if repo_count[o.repo] >= max_per_repo:
            continue
        if set(o.touches) & locked:
            continue
        picked.append(o)
        repo_count[o.repo] += 1
        locked |= set(o.touches)
    return picked


__all__ = ["next_dispatchable"]

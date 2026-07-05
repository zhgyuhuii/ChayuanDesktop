"""#11 多智能体串并行编排 DAG 引擎（纯逻辑，无 IO）。

节点=任务，边=依赖。支持：
- 串行链 / 并行扇出 / 汇聚 barrier（join=all）或首达即触发（join=any）
- 条件路由（edge.when：src 结果匹配才走；不匹配 → 该分支 dead，下游被跳过）
- 有界审核回环（edge.loop=True + Dag.max_loops：打回重跑，超上限即终止不再回环）

状态用两个纯字典表达，函数不改入参、返回新副本：
- outcomes: {node_id: 结果标签}（含哨兵 SKIPPED 表"被条件跳过"，也算 settled）
- visits:   {node_id: 已执行/回环计数}
"""

from __future__ import annotations

from dataclasses import dataclass, replace

#: 被条件路由跳过的节点结果哨兵（settled 但未真正执行）。
SKIPPED = "__skipped__"


@dataclass(frozen=True)
class Node:
    id: str
    #: "all"=barrier 等所有必需前驱；"any"=首个满足即触发。
    join: str = "all"


@dataclass(frozen=True)
class Edge:
    src: str
    dst: str
    #: 条件路由：仅当 outcomes[src] == when 才算满足；None=无条件。
    when: str | None = None
    #: 回环边：不参与常规就绪判定，靠 max_loops 控制重跑。
    loop: bool = False


@dataclass(frozen=True)
class Dag:
    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]
    #: 回环上限（防死循环）。
    max_loops: int = 3


def _preds(dag: Dag, nid: str) -> list[Edge]:
    return [e for e in dag.edges if e.dst == nid]


def _succs(dag: Dag, nid: str) -> list[Edge]:
    return [e for e in dag.edges if e.src == nid]


def _edge_satisfied(edge: Edge, outcomes: dict[str, str]) -> bool:
    if edge.src not in outcomes:
        return False
    val = outcomes[edge.src]
    if val == SKIPPED:
        return False
    return edge.when is None or val == edge.when


def _edge_dead(edge: Edge, outcomes: dict[str, str]) -> bool:
    """src 已 settled 但不满足（被跳过 或 条件不匹配）。"""
    return edge.src in outcomes and not _edge_satisfied(edge, outcomes)


def _descendants(dag: Dag, start: str) -> set[str]:
    """从 start 出发沿非回环边可达的节点（含 start）——回环重跑要清空的"回环体"。"""
    seen: set[str] = set()
    stack = [start]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        for e in _succs(dag, n):
            if not e.loop:
                stack.append(e.dst)
    return seen


def ready(dag: Dag, outcomes: dict[str, str], visits: dict[str, int]) -> set[str]:
    """当前可执行的节点集（纯函数）。"""
    result: set[str] = set()
    for node in dag.nodes:
        nid = node.id
        loop_preds = [e for e in _preds(dag, nid) if e.loop]
        non_loop_preds = [e for e in _preds(dag, nid) if not e.loop]
        settled = nid in outcomes

        # 回环重激活：settled 节点若有满足的回环入边且未超上限，再次就绪。
        loop_fire = (
            any(_edge_satisfied(e, outcomes) for e in loop_preds)
            and visits.get(nid, 0) < dag.max_loops
        )
        if settled:
            if loop_fire:
                result.add(nid)
            continue

        if not non_loop_preds:
            result.add(nid)  # 根节点
            continue
        sat = [e for e in non_loop_preds if _edge_satisfied(e, outcomes)]
        dead = [e for e in non_loop_preds if _edge_dead(e, outcomes)]
        if node.join == "any":
            if sat:  # 首个满足即触发，不等其余前驱（不 barrier）
                result.add(nid)
        else:  # all（barrier）：等所有前驱 settled；任一必需前驱 dead → 不触发（将被 skip 传播）
            if any(e.src not in outcomes for e in non_loop_preds):
                continue
            if not dead and sat:
                result.add(nid)
    return result


def _propagate_skips(dag: Dag, outcomes: dict[str, str]) -> None:
    """定点传播：前驱全 settled 但因条件路由无法触发的节点标 SKIPPED（就地）。"""
    changed = True
    while changed:
        changed = False
        for node in dag.nodes:
            nid = node.id
            if nid in outcomes:
                continue
            non_loop_preds = [e for e in _preds(dag, nid) if not e.loop]
            if not non_loop_preds:
                continue  # 根不自动跳过
            if any(e.src not in outcomes for e in non_loop_preds):
                continue  # 仍有 pending
            sat = [e for e in non_loop_preds if _edge_satisfied(e, outcomes)]
            dead = [e for e in non_loop_preds if _edge_dead(e, outcomes)]
            if node.join == "any":
                if not sat and dead:
                    outcomes[nid] = SKIPPED
                    changed = True
            else:  # all：任一 dead 即无法满足 barrier
                if dead:
                    outcomes[nid] = SKIPPED
                    changed = True


def record(
    dag: Dag,
    outcomes: dict[str, str],
    visits: dict[str, int],
    nid: str,
    outcome: str,
) -> tuple[dict[str, str], dict[str, int]]:
    """记录节点结果，处理回环重置与 skip 传播，返回新 (outcomes, visits)。"""
    outcomes = dict(outcomes)
    visits = dict(visits)
    visits[nid] = visits.get(nid, 0) + 1
    outcomes[nid] = outcome

    # 回环：本节点结果满足某回环边 → 若未超上限，清空回环体令其重跑。
    for e in _succs(dag, nid):
        if e.loop and _edge_satisfied(e, outcomes):
            target = e.dst
            if visits.get(target, 0) < dag.max_loops:
                visits[target] = visits.get(target, 0) + 1
                for d in _descendants(dag, target):
                    outcomes.pop(d, None)

    _propagate_skips(dag, outcomes)
    return outcomes, visits


def is_done(dag: Dag, outcomes: dict[str, str]) -> bool:
    """所有节点均 settled（含 SKIPPED）。"""
    return all(node.id in outcomes for node in dag.nodes)


__all__ = [
    "SKIPPED",
    "Node",
    "Edge",
    "Dag",
    "ready",
    "record",
    "is_done",
    "replace",
]

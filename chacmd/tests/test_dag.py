"""#11 多智能体串并行编排 DAG 引擎（纯逻辑）。

验收：一个 DAG 含串行链 + 并行扇出/汇聚 + 审核回环可执行。
"""

from chacmd.orchestrator.dag import (
    SKIPPED,
    Dag,
    Edge,
    Node,
    is_done,
    ready,
    record,
)


def _run(dag, outcomes_seq):
    """按 (nid, outcome) 序列驱动，返回最终 (outcomes, visits) 与每步 ready 快照。"""
    outcomes: dict[str, str] = {}
    visits: dict[str, int] = {}
    snapshots = []
    for nid, outcome in outcomes_seq:
        assert nid in ready(dag, outcomes, visits), f"{nid} 不在就绪集，非法驱动"
        outcomes, visits = record(dag, outcomes, visits, nid, outcome)
        snapshots.append(set(ready(dag, outcomes, visits)))
    return outcomes, visits, snapshots


def test_serial_chain():
    dag = Dag(
        nodes=(Node("a"), Node("b"), Node("c")),
        edges=(Edge("a", "b"), Edge("b", "c")),
    )
    assert ready(dag, {}, {}) == {"a"}
    outcomes, _, snaps = _run(dag, [("a", "succeeded"), ("b", "succeeded"), ("c", "succeeded")])
    assert snaps[0] == {"b"}
    assert snaps[1] == {"c"}
    assert snaps[2] == set()
    assert is_done(dag, outcomes)


def test_parallel_fanout_join_barrier():
    # a 扇出 b、c；d 汇聚（join=all，barrier 等 b 和 c 都完成）
    dag = Dag(
        nodes=(Node("a"), Node("b"), Node("c"), Node("d")),
        edges=(Edge("a", "b"), Edge("a", "c"), Edge("b", "d"), Edge("c", "d")),
    )
    assert ready(dag, {}, {}) == {"a"}
    o1, v1 = record(dag, {}, {}, "a", "succeeded")
    assert ready(dag, o1, v1) == {"b", "c"}
    o2, v2 = record(dag, o1, v1, "b", "succeeded")
    assert "d" not in ready(dag, o2, v2)  # barrier：d 还在等 c（c 仍就绪未跑）
    o3, v3 = record(dag, o2, v2, "c", "succeeded")
    assert ready(dag, o3, v3) == {"d"}
    o4, v4 = record(dag, o3, v3, "d", "succeeded")
    assert is_done(dag, o4)


def test_join_any_fires_on_first():
    dag = Dag(
        nodes=(Node("a"), Node("b"), Node("d", join="any")),
        edges=(Edge("a", "d"), Edge("b", "d")),
    )
    o1, v1 = record(dag, {}, {}, "a", "succeeded")
    assert "d" in ready(dag, o1, v1)  # any：不等 b


def test_conditional_routing_dead_branch_skips():
    # a 成功走 b、失败走 c；a=ok → b 就绪，c 被跳过
    dag = Dag(
        nodes=(Node("a"), Node("b"), Node("c")),
        edges=(Edge("a", "b", when="ok"), Edge("a", "c", when="fail")),
    )
    o1, v1 = record(dag, {}, {}, "a", "ok")
    assert ready(dag, o1, v1) == {"b"}
    assert o1["c"] == SKIPPED
    o2, v2 = record(dag, o1, v1, "b", "succeeded")
    assert is_done(dag, o2)  # c 跳过也算 settled


def test_bounded_review_loop():
    # work → review；review=rejected 回 work（有界回环）；review=approved → done
    dag = Dag(
        nodes=(Node("work"), Node("review"), Node("done")),
        edges=(
            Edge("work", "review"),
            Edge("review", "work", when="rejected", loop=True),
            Edge("review", "done", when="approved"),
        ),
        max_loops=2,
    )
    o, v = record(dag, {}, {}, "work", "succeeded")
    o, v = record(dag, o, v, "review", "rejected")
    # 打回 → work 再次就绪（第 2 次）
    assert "work" in ready(dag, o, v)
    assert v["work"] == 2
    o, v = record(dag, o, v, "work", "succeeded")
    o, v = record(dag, o, v, "review", "rejected")
    # 达到 max_loops=2 → 不再回环，work 不再就绪
    assert "work" not in ready(dag, o, v)


def test_bounded_loop_then_approve():
    dag = Dag(
        nodes=(Node("work"), Node("review"), Node("done")),
        edges=(
            Edge("work", "review"),
            Edge("review", "work", when="rejected", loop=True),
            Edge("review", "done", when="approved"),
        ),
        max_loops=3,
    )
    o, v = record(dag, {}, {}, "work", "succeeded")
    o, v = record(dag, o, v, "review", "approved")
    assert ready(dag, o, v) == {"done"}
    o, v = record(dag, o, v, "done", "succeeded")
    assert is_done(dag, o)


def test_diamond_dependency():
    # a→b, a→c, b→d, c→d：菱形，d 等 b、c
    dag = Dag(
        nodes=(Node("a"), Node("b"), Node("c"), Node("d")),
        edges=(Edge("a", "b"), Edge("a", "c"), Edge("b", "d"), Edge("c", "d")),
    )
    outcomes, _, _ = _run(
        dag,
        [("a", "succeeded"), ("b", "succeeded"), ("c", "succeeded"), ("d", "succeeded")],
    )
    assert is_done(dag, outcomes)

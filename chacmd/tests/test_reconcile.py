"""#13 容灾 reconcile 决策 + leader/lease 单活（纯逻辑，Fake 时钟）。

验收：杀掉容器后自动重建并续跑（决策层）；死容器在途 Task→interrupted（NFR-R1 至少一次+去重）；
reconcile 必须 leader 单活（NFR-S2，防多实例双拉替身）。
"""

from chacmd.orchestrator.reconcile import (
    DesiredContainer,
    LeaderLease,
    is_leader,
    reconcile,
    reconcile_if_leader,
    try_acquire,
)

DESIRED = [DesiredContainer("dev", role="engineer"), DesiredContainer("qa", role="reviewer")]


def test_reconcile_rebuilds_dead_container():
    actions = reconcile(DESIRED, alive={"qa"}, dead={"dev"}, inflight={})
    kinds = [(a.kind, a.target) for a in actions]
    assert ("rebuild", "dev") in kinds


def test_reconcile_interrupts_inflight_on_dead():
    actions = reconcile(DESIRED, alive={"qa"}, dead={"dev"}, inflight={"t1": "dev", "t2": "qa"})
    interrupts = [a.target for a in actions if a.kind == "interrupt_task"]
    assert interrupts == ["t1"]  # 只中断死容器上的在途任务


def test_reconcile_no_action_when_all_alive():
    assert reconcile(DESIRED, alive={"dev", "qa"}, dead=set(), inflight={"t1": "dev"}) == []


def test_leader_first_acquires():
    lease = LeaderLease()
    lease2, ok = try_acquire(lease, "node-A", now=100.0, ttl=30.0)
    assert ok is True
    assert is_leader(lease2, "node-A", now=110.0) is True


def test_leader_second_denied_while_valid():
    lease, _ = try_acquire(LeaderLease(), "node-A", now=100.0, ttl=30.0)
    lease2, ok = try_acquire(lease, "node-B", now=110.0, ttl=30.0)
    assert ok is False
    assert lease2.holder == "node-A"


def test_leader_changes_after_expiry():
    lease, _ = try_acquire(LeaderLease(), "node-A", now=100.0, ttl=30.0)
    # 130 之后 A 的租约过期 → B 可接管
    lease2, ok = try_acquire(lease, "node-B", now=131.0, ttl=30.0)
    assert ok is True
    assert lease2.holder == "node-B"


def test_holder_renews():
    lease, _ = try_acquire(LeaderLease(), "node-A", now=100.0, ttl=30.0)
    lease2, ok = try_acquire(lease, "node-A", now=115.0, ttl=30.0)
    assert ok is True
    assert lease2.expires_at == 145.0  # 续租


def test_reconcile_if_leader_noops_for_non_leader():
    lease, _ = try_acquire(LeaderLease(), "node-A", now=100.0, ttl=30.0)
    # node-B 非 leader → 不产生任何动作（NFR-S2 单活）
    actions = reconcile_if_leader(
        lease, "node-B", now=110.0, desired=DESIRED, alive={"qa"}, dead={"dev"}, inflight={}
    )
    assert actions == []
    # leader 本人 → 正常决策
    actions2 = reconcile_if_leader(
        lease, "node-A", now=110.0, desired=DESIRED, alive={"qa"}, dead={"dev"}, inflight={}
    )
    assert any(a.kind == "rebuild" for a in actions2)

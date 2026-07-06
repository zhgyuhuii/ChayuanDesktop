"""调度器·CI/GitLab webhook 事件源 → 九步状态流转（work-model 第四章：调度器与 CI webhook 推动流转）。"""

from chacmd.scheduler.webhook import apply_event, normalize_gitlab
from chacmd.scheduler.workorder import WorkOrderState as S


def test_normalize_pipeline_success():
    payload = {"object_kind": "pipeline", "object_attributes": {"status": "success"}}
    assert normalize_gitlab(payload) == "ci_passed"


def test_normalize_pipeline_failed():
    payload = {"object_kind": "pipeline", "object_attributes": {"status": "failed"}}
    assert normalize_gitlab(payload) == "ci_failed"


def test_normalize_mr_approved_and_merge():
    assert normalize_gitlab({"object_kind": "merge_request", "object_attributes": {"action": "approve"}}) == "review_approved"
    assert normalize_gitlab({"object_kind": "merge_request", "object_attributes": {"action": "merge"}}) == "merged"


def test_normalize_unknown_returns_none():
    assert normalize_gitlab({"object_kind": "push"}) is None


def test_ci_passed_advances():
    assert apply_event(S.IN_PROGRESS, "ci_passed") == S.CI_PASSED


def test_ci_failed_recycles():
    assert apply_event(S.IN_PROGRESS, "ci_failed") == S.IN_PROGRESS  # 回炉自转


def test_review_rejected_recycles_from_ci_passed():
    assert apply_event(S.CI_PASSED, "review_rejected") == S.IN_PROGRESS


def test_full_forward_chain_via_events():
    st = S.IN_PROGRESS
    for ev, expect in [
        ("ci_passed", S.CI_PASSED),
        ("review_approved", S.REVIEWED),
        ("merged", S.MERGED),
        ("staged", S.STAGING),
        ("canary", S.CANARY),
        ("released", S.RELEASED),
    ]:
        st = apply_event(st, ev)
        assert st == expect


def test_illegal_event_is_noop():
    # ready 收到 ci_passed（还没派单）→ 非法，保持 ready（幂等，不崩）
    assert apply_event(S.READY, "ci_passed") == S.READY


def test_unknown_event_is_noop():
    assert apply_event(S.IN_PROGRESS, "bogus") == S.IN_PROGRESS

import pytest

from chacmd.domain.state import JobState, can_transition, transition


def test_happy_path_transitions():
    assert can_transition(JobState.QUEUED, JobState.DISPATCHING)
    assert can_transition(JobState.DISPATCHING, JobState.RUNNING)
    assert can_transition(JobState.RUNNING, JobState.SUCCEEDED)


def test_approval_loop():
    assert can_transition(JobState.RUNNING, JobState.PENDING_APPROVAL)
    assert can_transition(JobState.PENDING_APPROVAL, JobState.RUNNING)      # approved
    assert can_transition(JobState.PENDING_APPROVAL, JobState.CANCELLED)    # rejected→cancel


def test_interrupted_from_running():
    assert can_transition(JobState.RUNNING, JobState.INTERRUPTED)


def test_illegal_transition_raises():
    with pytest.raises(ValueError):
        transition(JobState.SUCCEEDED, JobState.RUNNING)  # terminal → nothing


def test_cancelled_is_terminal():
    # 打回后进 cancelled，不可再被批准（NFR-H1 审批不可撤销）
    assert not can_transition(JobState.CANCELLED, JobState.RUNNING)

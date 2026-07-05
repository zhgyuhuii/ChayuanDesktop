from chacmd.adapters.openhands_adapter import map_openhands_line


def _m(line, seq=0):
    return map_openhands_line(line, job_id="j", task_id="t", nickname="w", seq=seq)


def test_agent_start_maps_to_started():
    assert _m({"action": "start"}).kind == "started"


def test_run_action_maps_to_progress():
    e = _m({"action": "run", "args": {"command": "ls"}}, seq=1)
    assert e.kind == "progress"
    assert e.payload["command"] == "ls"


def test_finish_maps_to_succeeded():
    e = _m({"observation": "agent_state_changed", "extras": {"agent_state": "finished"}}, seq=2)
    assert e.kind == "succeeded"


def test_error_maps_to_failed():
    e = _m({"observation": "error", "message": "boom"}, seq=3)
    assert e.kind == "failed"
    assert e.payload["message"] == "boom"


def test_token_usage_carried_in_payload():
    e = _m({"action": "message", "llm_metrics": {"total_tokens": 42}}, seq=4)
    assert e.payload.get("tokens") == 42


def test_unknown_line_defaults_to_progress():
    e = _m({"foo": "bar"}, seq=5)
    assert e.kind == "progress"

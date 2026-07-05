from chacmd.observability.otel import inject_traceparent


def test_traceparent_added_to_message():
    msg = {"kind": "started", "seq": 0}
    out = inject_traceparent(msg, job_id="j1")
    assert "traceparent" in out
    assert out["baggage"]["job_id"] == "j1"
    # W3C traceparent 形态：00-<32hex>-<16hex>-01
    parts = out["traceparent"].split("-")
    assert len(parts) == 4
    assert parts[0] == "00"
    assert len(parts[1]) == 32


def test_inject_does_not_mutate_input():
    msg = {"kind": "x"}
    inject_traceparent(msg, job_id="j")
    assert "traceparent" not in msg  # 原 dict 不被污染

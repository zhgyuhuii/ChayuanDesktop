"""#12 A2A 直连（数据走共享卷直传 + 消息走总线；指挥台旁路审计；hop/TTL 防环）。"""

from chacmd.orchestrator.a2a import A2AMessage, relay


def test_relay_forwards_and_increments_hop():
    msg = A2AMessage(src="a", dst="b", payload={"x": 1}, hop=0, ttl=8, path=("a",))
    r = relay(msg)
    assert r.forwarded is not None
    assert r.forwarded.hop == 1
    assert r.forwarded.ttl == 7
    assert r.forwarded.path == ("a", "b")
    assert r.dropped_reason is None


def test_relay_audit_record_present():
    r = relay(A2AMessage(src="a", dst="b", payload={}, path=("a",)))
    assert r.audit["src"] == "a"
    assert r.audit["dst"] == "b"


def test_ttl_exhausted_dropped():
    r = relay(A2AMessage(src="a", dst="b", payload={}, ttl=0, path=("a",)))
    assert r.forwarded is None
    assert r.dropped_reason == "ttl_exhausted"


def test_loop_detected_and_dropped():
    # dst 已在 path → 环，丢弃
    r = relay(A2AMessage(src="c", dst="a", payload={}, ttl=5, path=("a", "b", "c")))
    assert r.forwarded is None
    assert r.dropped_reason == "loop"


def test_volume_ref_passthrough():
    # 大产物走共享卷引用，不塞进消息 payload
    msg = A2AMessage(src="a", dst="b", payload={}, path=("a",), volume_ref="/workspace/job-1/output/big.bin")
    r = relay(msg)
    assert r.forwarded.volume_ref == "/workspace/job-1/output/big.bin"

from chayuan.server.knowledge_base.kb_summary.oversize import summarize_precheck

def test_under_threshold_runs():
    r = summarize_precheck(chunk_count=10, confirmed=False, threshold=60)
    assert r.needs_confirm is False

def test_over_threshold_needs_confirm():
    r = summarize_precheck(chunk_count=120, confirmed=False, threshold=60)
    assert r.needs_confirm is True
    assert r.chunk_count == 120
    assert r.est_llm_calls >= 120

def test_over_threshold_confirmed_runs():
    r = summarize_precheck(chunk_count=120, confirmed=True, threshold=60)
    assert r.needs_confirm is False

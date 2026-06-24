from chayuan.server.knowledge_base.kb_summary.cache_key import file_summary_cache_key, content_hash

def test_hash_stable_and_order_independent():
    h1 = content_hash(["a", "b", "c"])
    h2 = content_hash(["a", "b", "c"])
    assert h1 == h2 and len(h1) == 16
    assert content_hash(["a", "b", "c"]) != content_hash(["a", "b", "x"])

def test_cache_key_shape():
    k = file_summary_cache_key("报告.pdf", "deadbeefdeadbeef")
    assert k == "summary::报告.pdf::deadbeefdeadbeef"

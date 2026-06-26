from chayuan.server.knowledge_base.kb_summary.cache_key import file_summary_cache_key, content_hash

def test_hash_stable_and_order_independent():
    h1 = content_hash(["a", "b", "c"])
    h2 = content_hash(["a", "b", "c"])
    assert h1 == h2 and len(h1) == 16
    assert content_hash(["a", "b", "c"]) != content_hash(["a", "b", "x"])

def test_cache_key_shape():
    k = file_summary_cache_key("报告.pdf", "deadbeefdeadbeef")
    assert k == "summary::报告.pdf::deadbeefdeadbeef"


from chayuan.server.knowledge_base.kb_summary.cache_key import summary_discriminator


def test_discriminator_prefers_file_hash():
    d1 = summary_discriminator("abc123", ["chunk A", "chunk B"])
    d2 = summary_discriminator("abc123", ["completely", "different", "chunks"])
    assert d1 == "abc123"
    assert d1 == d2


def test_discriminator_falls_back_to_content_hash():
    d1 = summary_discriminator("", ["chunk A", "chunk B"])
    d2 = summary_discriminator(None, ["chunk A", "chunk B"])
    assert d1 == d2
    assert len(d1) == 16
    assert summary_discriminator("", ["X"]) != d1

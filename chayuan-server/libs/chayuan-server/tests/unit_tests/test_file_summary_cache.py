from unittest import mock
from chayuan.server.knowledge_base.kb_summary import file_summary_cache as fsc

def test_get_returns_none_on_miss():
    store = mock.Mock()
    store.search_by_key.return_value = None
    assert fsc.get_cached_summary(store, "summary::a::h") is None

def test_get_returns_text_on_hit():
    store = mock.Mock()
    store.search_by_key.return_value = "整篇摘要正文"
    assert fsc.get_cached_summary(store, "summary::a::h") == "整篇摘要正文"

def test_put_swallows_errors():
    store = mock.Mock()
    store.put.side_effect = RuntimeError("faiss down")
    fsc.put_summary(store, "k", "t")  # must not raise

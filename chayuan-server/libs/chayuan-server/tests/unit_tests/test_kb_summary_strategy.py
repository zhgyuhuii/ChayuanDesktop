from chayuan.server.knowledge_base.kb_summary.strategy import choose_summary_strategy

def test_auto_short_to_stuff():
    assert choose_summary_strategy(total_chars=2000, chunk_count=2) == "stuff"

def test_auto_long_to_map_reduce():
    assert choose_summary_strategy(total_chars=100000, chunk_count=125) == "map_reduce"

def test_auto_few_chunks_to_stuff_even_if_threshold_chars():
    assert choose_summary_strategy(total_chars=9000, chunk_count=2) == "stuff"

def test_explicit_passes_through():
    assert choose_summary_strategy(total_chars=100000, chunk_count=125, requested="stuff") == "stuff"
    assert choose_summary_strategy(total_chars=100, chunk_count=1, requested="map_reduce") == "map_reduce"
    assert choose_summary_strategy(total_chars=100, chunk_count=1, requested="refine") == "refine"

def test_unknown_requested_falls_back_to_auto():
    assert choose_summary_strategy(total_chars=100000, chunk_count=125, requested="bogus") == "map_reduce"

def test_threshold_boundary():
    assert choose_summary_strategy(total_chars=8000, chunk_count=10) == "stuff"
    assert choose_summary_strategy(total_chars=8001, chunk_count=10) == "map_reduce"

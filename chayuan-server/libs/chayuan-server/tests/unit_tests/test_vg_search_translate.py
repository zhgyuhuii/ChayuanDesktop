from chayuan.server.api_server import video_generation_routes as r


def test_maybe_translate_query_ascii_passthrough():
    # 纯英文/ASCII 直接原样返回,不调 LLM
    assert r._maybe_translate_query("spring flower", True) == "spring flower"


def test_maybe_translate_query_disabled():
    assert r._maybe_translate_query("春天的花", False) == "春天的花"


def test_maybe_translate_query_cjk_uses_terms(monkeypatch):
    # 含中文 + 开启 → 走 generate_terms,取首个英文词
    import chayuan.server.video_generation.steps.script as script
    monkeypatch.setattr(script, "generate_terms", lambda subj, scr, amount=1, **k: ["spring flower"])
    assert r._maybe_translate_query("春天的花", True) == "spring flower"


def test_maybe_translate_query_terms_empty_fallback(monkeypatch):
    import chayuan.server.video_generation.steps.script as script
    monkeypatch.setattr(script, "generate_terms", lambda subj, scr, amount=1, **k: [])
    # generate_terms 返空 → 回退原词
    assert r._maybe_translate_query("春天的花", True) == "春天的花"

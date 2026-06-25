from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, resolve_model_ctx, map_input_char_budget, DEFAULT_CTX,
    MAP_MAX_TOKENS, REDUCE_MAX_TOKENS,
)


def test_estimate_tokens_chinese_is_conservative():
    assert estimate_tokens("答辩状内容") >= 5
    assert estimate_tokens("") == 0


def test_estimate_tokens_ascii_words():
    assert estimate_tokens("hello world foo") >= 3


def test_resolve_model_ctx_falls_back_to_default():
    assert resolve_model_ctx("nonexistent-model-xyz") == DEFAULT_CTX


def test_map_input_char_budget_leaves_room_for_output_and_template():
    budget_tokens, budget_chars = map_input_char_budget(DEFAULT_CTX)
    assert 0 < budget_tokens < DEFAULT_CTX - MAP_MAX_TOKENS
    assert budget_chars > 0

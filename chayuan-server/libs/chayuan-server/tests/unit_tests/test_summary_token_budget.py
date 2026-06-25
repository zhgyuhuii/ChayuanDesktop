from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, resolve_model_ctx, map_input_char_budget, DEFAULT_CTX,
    MAP_MAX_TOKENS, REDUCE_MAX_TOKENS,
)


def test_estimate_tokens_chinese_is_conservative():
    assert estimate_tokens("答辩状内容") >= 5
    assert estimate_tokens("") == 0


def test_estimate_tokens_ascii_words():
    # "hello world foo" 共 15 字符 → ceil(15/3) = 5 token 上界
    assert estimate_tokens("hello world foo") >= 5


def test_resolve_model_ctx_falls_back_to_default():
    assert resolve_model_ctx("nonexistent-model-xyz") == DEFAULT_CTX


def test_resolve_model_ctx_reads_metadata(monkeypatch):
    import pytest
    pytest.importorskip("sqlalchemy")  # 该用例需 DB 栈(真实 py312 测试环境有);缺依赖则跳过
    from chayuan.server.db.repository import model_metadata_repository as mmr
    monkeypatch.setattr(
        mmr, "list_all",
        lambda: [{"model_id": "qwen-max", "context_length": 32768}],
    )
    from chayuan.server.knowledge_base.kb_summary import token_budget
    assert token_budget.resolve_model_ctx("qwen-max") == 32768
    assert token_budget.resolve_model_ctx("platform::qwen-max") == 32768
    # 未知模型仍回退
    assert token_budget.resolve_model_ctx("unknown-zzz") == token_budget.DEFAULT_CTX


def test_reduce_group_token_budget_in_range():
    from chayuan.server.knowledge_base.kb_summary.token_budget import (
        reduce_group_token_budget, DEFAULT_CTX, REDUCE_MAX_TOKENS,
    )
    b = reduce_group_token_budget(DEFAULT_CTX)
    assert 0 < b < DEFAULT_CTX - REDUCE_MAX_TOKENS


def test_map_input_char_budget_leaves_room_for_output_and_template():
    budget_tokens, budget_chars = map_input_char_budget(DEFAULT_CTX)
    assert 0 < budget_tokens < DEFAULT_CTX - MAP_MAX_TOKENS
    assert budget_chars > 0

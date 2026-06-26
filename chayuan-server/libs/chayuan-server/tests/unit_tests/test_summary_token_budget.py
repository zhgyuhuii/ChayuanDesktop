from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, resolve_model_ctx, map_input_char_budget, DEFAULT_CTX,
    CLOUD_DEFAULT_CTX, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS, map_concurrency_for,
    MAP_CONCURRENCY,
)


def test_map_concurrency_local_is_serial():
    # 本地单 llama-server 共享 ctx → 必须串行(1),否则并发会 N×budget 溢出
    assert map_concurrency_for("models/bundled/chat/Qwen3-4B") == 1
    assert map_concurrency_for("local-chat/foo") == 1
    assert map_concurrency_for("openai::models/bundled/x") == 1


def test_map_concurrency_cloud_is_parallel():
    # 云端模型每请求独立 ctx 且能并发 → 并行提速
    assert map_concurrency_for("deepseek-r1") == MAP_CONCURRENCY
    assert map_concurrency_for("siliconflow::deepseek-ai/DeepSeek-R1") == MAP_CONCURRENCY
    assert MAP_CONCURRENCY > 1


def test_estimate_tokens_chinese_is_conservative():
    assert estimate_tokens("答辩状内容") >= 5
    assert estimate_tokens("") == 0


def test_estimate_tokens_ascii_words():
    # "hello world foo" 共 15 字符 → ceil(15/3) = 5 token 上界
    assert estimate_tokens("hello world foo") >= 5


def test_resolve_model_ctx_falls_back_to_cloud_default():
    # 未知的「云端」模型(无 metadata)→ CLOUD_DEFAULT_CTX(8192),使典型文档仍能单次整篇;
    # 空名 → DEFAULT_CTX(4096,最保守)
    assert resolve_model_ctx("nonexistent-model-xyz") == CLOUD_DEFAULT_CTX
    assert resolve_model_ctx("") == DEFAULT_CTX
    assert resolve_model_ctx(None) == DEFAULT_CTX
    assert CLOUD_DEFAULT_CTX > DEFAULT_CTX


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
    # 未知云端模型回退到 CLOUD_DEFAULT_CTX(不是 4096)
    assert token_budget.resolve_model_ctx("unknown-zzz") == token_budget.CLOUD_DEFAULT_CTX


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


def test_resolve_model_ctx_local_bundled_uses_default_not_metadata(monkeypatch):
    pytest_mod = __import__("pytest"); pytest_mod.importorskip("sqlalchemy")
    from chayuan.server.db.repository import model_metadata_repository as mmr
    # 即便 metadata 给本地模型标了 32768(训练上下文),本地也必须用运行时 DEFAULT_CTX
    monkeypatch.setattr(mmr, "list_all",
        lambda: [{"model_id": "models/bundled/chat/Qwen3-4B-Instruct-2507-GGUF", "context_length": 32768}])
    from chayuan.server.knowledge_base.kb_summary import token_budget
    assert token_budget.resolve_model_ctx("models/bundled/chat/Qwen3-4B-Instruct-2507-GGUF") == token_budget.DEFAULT_CTX
    assert token_budget.resolve_model_ctx("local-chat/foo") == token_budget.DEFAULT_CTX


def test_raptor_threshold_constant():
    from chayuan.server.knowledge_base.kb_summary.token_budget import RAPTOR_CHUNK_THRESHOLD
    assert RAPTOR_CHUNK_THRESHOLD == 200

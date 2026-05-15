"""resolve_llamacpp_args capability 分支测试。"""
from __future__ import annotations

import pytest

from chayuan.server.model_registry import process_args


def _fake_entry(model_id, fmt, path):
    return type("Entry", (), {
        "model_id": model_id,
        "format": fmt,
        "path": path,
        "capability": "chat",  # 不重要,_resolve 通过 local_cap 查
    })()


def test_resolve_llamacpp_args_chat_default(monkeypatch):
    """capability=chat (默认) 走 chat default。args 含 --model + --ctx-size。"""
    e = _fake_entry("qwen3-4b", "gguf", "/tmp/qwen.gguf")
    monkeypatch.setattr(process_args, "_resolve", lambda cap, **kw: (e, ""))
    r = process_args.resolve_llamacpp_args(n_ctx=8192)
    assert r.process == "llamacpp"
    assert "--model" in r.args
    assert "/tmp/qwen.gguf" in r.args
    assert "--ctx-size" in r.args
    assert "8192" in r.args
    # chat 不带 --embedding / --reranking
    assert "--embedding" not in r.args
    assert "--reranking" not in r.args
    assert r.resolved_models["chat"] == "qwen3-4b"


def test_resolve_llamacpp_args_embedding(monkeypatch):
    """capability=embedding 走 embedding default。args 含 --embedding --pooling cls。"""
    e = _fake_entry("bge-small", "gguf", "/tmp/bge.gguf")
    monkeypatch.setattr(process_args, "_resolve", lambda cap, **kw: (e, ""))
    r = process_args.resolve_llamacpp_args(capability="embedding")
    assert "--model" in r.args
    assert "/tmp/bge.gguf" in r.args
    assert "--embedding" in r.args
    assert "--pooling" in r.args
    assert "cls" in r.args
    assert "--reranking" not in r.args
    assert r.resolved_models["embedding"] == "bge-small"


def test_resolve_llamacpp_args_rerank(monkeypatch):
    """capability=rerank 走 rerank default。args 含 --reranking。"""
    e = _fake_entry("bge-rerank", "gguf", "/tmp/rerank.gguf")
    monkeypatch.setattr(process_args, "_resolve", lambda cap, **kw: (e, ""))
    r = process_args.resolve_llamacpp_args(capability="rerank")
    assert "--reranking" in r.args
    assert "--embedding" not in r.args
    assert r.resolved_models["rerank"] == "bge-rerank"


def test_resolve_llamacpp_args_unknown_capability_raises():
    with pytest.raises(ValueError, match="capability"):
        process_args.resolve_llamacpp_args(capability="asr")  # type: ignore[arg-type]


def test_resolve_llamacpp_args_missing_model_reports_capability(monkeypatch):
    """模型未解到时 missing 列表里是 capability 名,不是 'chat' 硬编码。"""
    monkeypatch.setattr(process_args, "_resolve", lambda cap, **kw: (None, "no candidate"))
    r = process_args.resolve_llamacpp_args(capability="embedding")
    assert "embedding" in r.missing
    assert "chat" not in r.missing

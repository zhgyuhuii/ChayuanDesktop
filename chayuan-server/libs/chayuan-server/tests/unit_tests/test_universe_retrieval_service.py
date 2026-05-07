from __future__ import annotations

import asyncio

from chayuan.server.retrieval.universe import service


def test_block_to_chunks_normalizes_structured_rows_and_sql():
    chunks = service.block_to_chunks(
        {
            "ku_id": "src:7",
            "kind": "structured",
            "summary": "共有 3 个用户",
            "sql": "select count(*) as total from users",
            "columns": ["total"],
            "rows": [{"total": 3}],
            "results": [],
        },
        tag="count",
        section_ids=["s1"],
    )

    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk["kb_name"] == "src:7"
    assert "共有 3 个用户" in chunk["text"]
    assert "select count(*)" in chunk["text"]
    assert chunk["metadata"]["rows"] == [{"total": 3}]
    assert chunk["from_query_tags"] == ["count"]
    assert chunk["from_section_ids"] == ["s1"]


def test_search_ku_chunks_keeps_partial_success_when_one_source_fails(monkeypatch):
    def fake_process(ku_id, query, top_k, **kwargs):
        if ku_id == "src:bad":
            raise RuntimeError("model 'qwen3.6:latest' not found")
        return {
            "ku_id": ku_id,
            "kind": "structured",
            "ok": True,
            "summary": "共有 1 个用户",
            "sql": "select count(*) as total from users",
            "rows": [{"total": 1}],
        }

    monkeypatch.setattr(service, "_process_one", fake_process)

    chunks, errors, blocks = asyncio.run(service.search_ku_chunks(
        [
            ("src:ok", "有多少个用户", "q1", []),
            ("src:bad", "有多少个用户", "q1", []),
        ],
        top_k=3,
        timeout_s=5,
        max_concurrency=2,
    ))

    assert len(blocks) == 2
    assert len(chunks) == 2
    assert any(chunk["kb_name"] == "src:ok" and "共有 1 个用户" in chunk["text"] for chunk in chunks)
    assert any(chunk["kb_name"] == "src:bad" and "结构化检索模型不可用" in chunk["text"] for chunk in chunks)
    assert errors == [{"kb": "src:bad", "tag": "q1", "error": "结构化检索模型不可用，请检查 Ollama 模型配置。"}]

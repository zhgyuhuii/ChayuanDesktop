"""ModelScopeAdapter fixture 驱动单测（monkeypatch _put_json/_get_json，不联网）。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from chayuan.server.model_registry.hub_catalog.modelscope import ModelScopeAdapter

_FIX = Path(__file__).parent / "fixtures" / "hub"


def _load(name):
    with open(_FIX / name, "r", encoding="utf-8") as f:
        return json.load(f)


_VALID_CAPS = {
    "chat", "text-embedding", "rerank", "image-to-text", "image-embedding",
    "text-to-image", "text-to-video", "text-to-audio", "speech-to-text", "other",
}


def test_search_normalizes(monkeypatch):
    a = ModelScopeAdapter()
    fixture = _load("ms_search.json")
    monkeypatch.setattr(a, "_put_json", lambda *args, **kw: fixture)

    page = a.search(query="qwen", page=1, page_size=3)
    assert len(page.items) == 3
    for card in page.items:
        assert card.source == "modelscope"
        assert "/" in card.model_id
        assert card.capability in _VALID_CAPS
        assert card.owner == card.model_id.split("/")[0]
    assert page.total == 21131


def test_search_tasks_null_does_not_crash(monkeypatch):
    # fixture 第二个模型 Tasks=None，必须归一为 other 而不抛。
    a = ModelScopeAdapter()
    fixture = _load("ms_search.json")
    monkeypatch.setattr(a, "_put_json", lambda *args, **kw: fixture)
    page = a.search(query="qwen", page=1, page_size=3)
    caps = [c.capability for c in page.items]
    assert "other" in caps  # Tasks=None 那条
    assert "image-to-text" in caps  # Tasks 含 image-text-to-text 的那条


def test_search_updated_at_iso(monkeypatch):
    # MS LastUpdatedTime 是 unix int，归一后应是 ISO 字符串。
    a = ModelScopeAdapter()
    fixture = _load("ms_search.json")
    monkeypatch.setattr(a, "_put_json", lambda *args, **kw: fixture)
    page = a.search(page=1, page_size=3)
    for c in page.items:
        if c.updated_at is not None:
            assert "T" in c.updated_at  # ISO-8601


def test_detail_sizes(monkeypatch):
    a = ModelScopeAdapter()
    files_fixture = _load("ms_files.json")
    monkeypatch.setattr(a, "_get_json", lambda *args, **kw: files_fixture)

    files = a.detail(model_id="Qwen/Qwen2.5-0.5B-Instruct-GGUF")
    assert len(files) >= 1
    total = sum((f.size_bytes or 0) for f in files)
    assert total > 0
    gguf = [f for f in files if f.rfilename.endswith(".gguf")]
    assert gguf
    assert all(f.runnable for f in gguf)


def test_search_sort_updated_local_orders_by_updated_at(monkeypatch):
    # ModelScope 服务端不支持 updated 排序；sort='updated' 时本页按 updated_at 降序。
    a = ModelScopeAdapter()
    fixture = _load("ms_search.json")
    monkeypatch.setattr(a, "_put_json", lambda *args, **kw: fixture)
    page = a.search(page=1, page_size=3, sort="updated")
    ups = [c.updated_at or "" for c in page.items]
    assert ups == sorted(ups, reverse=True)

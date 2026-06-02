"""HuggingFaceAdapter fixture 驱动单测（monkeypatch _get_json，不联网）。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from chayuan.server.model_registry.hub_catalog import _SERVEABLE_CAPS
from chayuan.server.model_registry.hub_catalog.huggingface import HuggingFaceAdapter

_FIX = Path(__file__).parent / "fixtures" / "hub"


def _load(name):
    with open(_FIX / name, "r", encoding="utf-8") as f:
        return json.load(f)


_VALID_CAPS = {
    "chat", "text-embedding", "rerank", "image-to-text", "image-embedding",
    "text-to-image", "text-to-video", "text-to-audio", "speech-to-text", "other",
}


def test_search_normalizes(monkeypatch):
    a = HuggingFaceAdapter()
    fixture = _load("hf_search.json")
    monkeypatch.setattr(a, "_get_json", lambda *args, **kw: fixture)

    page = a.search(query="qwen", page=1, page_size=3)
    assert len(page.items) == 3
    for card in page.items:
        assert card.source == "huggingface"
        assert "/" in card.model_id
        assert card.capability in _VALID_CAPS
        assert card.owner == card.model_id.split("/")[0]
    # 列表页不带 file_size_bytes。
    assert all(c.file_size_bytes is None for c in page.items)


def test_search_capability_mapping(monkeypatch):
    a = HuggingFaceAdapter()
    fixture = _load("hf_search.json")
    monkeypatch.setattr(a, "_get_json", lambda *args, **kw: fixture)
    page = a.search(query="qwen", page=1, page_size=3)
    caps = {c.capability for c in page.items}
    # fixture pipeline_tags: text-generation, image-text-to-text x2
    assert "chat" in caps
    assert "image-to-text" in caps


def test_search_has_more(monkeypatch):
    a = HuggingFaceAdapter()
    fixture = _load("hf_search.json")  # 3 items
    monkeypatch.setattr(a, "_get_json", lambda *args, **kw: fixture)
    # page_size == 返回数 -> has_more True
    assert a.search(page_size=3).has_more is True
    # page_size > 返回数 -> has_more False
    assert a.search(page_size=10).has_more is False


def test_detail_sizes(monkeypatch):
    a = HuggingFaceAdapter()
    tree = _load("hf_tree.json")
    monkeypatch.setattr(a, "_get_json", lambda *args, **kw: tree)

    files = a.detail(model_id="Qwen/Qwen2.5-0.5B-Instruct-GGUF")
    assert len(files) >= 1
    gguf = [f for f in files if f.rfilename.endswith(".gguf")]
    assert gguf, "expected at least one .gguf file"
    assert all(f.runnable for f in gguf)
    assert all((f.size_bytes or 0) > 0 for f in gguf)


def test_search_sort_param_maps_to_hf(monkeypatch):
    # sort='updated' 应下发 HF 原生 sort=lastModified；默认 downloads。
    a = HuggingFaceAdapter()
    fixture = _load("hf_search.json")
    captured = {}

    def fake(url, *, token=None, **kw):
        captured["params"] = kw.get("params")
        return fixture

    monkeypatch.setattr(a, "_get_json", fake)

    a.search(query="q", sort="updated", page_size=3)
    assert captured["params"]["sort"] == "lastModified"

    a.search(query="q", page_size=3)  # 默认
    assert captured["params"]["sort"] == "downloads"

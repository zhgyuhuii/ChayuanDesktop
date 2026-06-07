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
    fixture = _load("hf_search.json")  # 3 items；mock 忽略 limit 恒返 3 条
    monkeypatch.setattr(a, "_get_json", lambda *args, **kw: fixture)
    # 本页装不下(page_size < 总数) -> 还有下一页
    assert a.search(page=1, page_size=2).has_more is True
    # 本页装得下(page_size >= 总数) -> 没有下一页
    assert a.search(page=1, page_size=3).has_more is False


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


def test_readme_uses_route_host_and_returns_text(monkeypatch):
    a = HuggingFaceAdapter()
    captured = {}

    def fake_get_text(url, *, token=None, **kw):
        captured["url"] = url
        captured["token"] = token
        return "# Hello\n\nbody"

    monkeypatch.setattr(a, "_get_text", fake_get_text)

    md = a.readme(model_id="Qwen/Qwen2-0.5B-Instruct", route="official", token="t")
    assert md == "# Hello\n\nbody"
    assert captured["url"] == "https://huggingface.co/Qwen/Qwen2-0.5B-Instruct/raw/main/README.md"
    assert captured["token"] == "t"

    # mirror 路线（默认）。
    md2 = a.readme(model_id="Qwen/Qwen2-0.5B-Instruct")
    assert captured["url"].startswith("https://hf-mirror.com/")


def test_readme_swallows_errors(monkeypatch):
    a = HuggingFaceAdapter()

    def boom(url, *, token=None, **kw):
        raise RuntimeError("401")

    monkeypatch.setattr(a, "_get_text", boom)
    assert a.readme(model_id="x/y") == ""


def test_search_sends_pipeline_tag_for_capability(monkeypatch):
    # 指定 capability 必须服务端下发 pipeline_tag,且不再强制 filter=gguf。
    a = HuggingFaceAdapter()
    captured = {}

    def fake(url, *, token=None, **kw):
        captured["params"] = kw.get("params")
        return []

    monkeypatch.setattr(a, "_get_json", fake)
    a.search(capability="rerank", page_size=3)
    assert captured["params"].get("pipeline_tag") == "text-ranking"
    assert "filter" not in captured["params"]


def test_search_pipeline_tag_sent_even_when_runnable_only(monkeypatch):
    # runnable_only 开着也要下发 pipeline_tag(嵌入),不能被 gguf 顶替筛空。
    a = HuggingFaceAdapter()
    captured = {}

    def fake(url, *, token=None, **kw):
        captured["params"] = kw.get("params")
        return []

    monkeypatch.setattr(a, "_get_json", fake)
    a.search(capability="text-embedding", runnable_only=True, page_size=3)
    assert captured["params"].get("pipeline_tag") == "feature-extraction"
    assert "filter" not in captured["params"]


def test_search_paginates_by_local_window(monkeypatch):
    # HF offset 失效 -> 取 page*page_size+1 条本地切片拿到第 page 页。
    a = HuggingFaceAdapter()
    rows = [{"id": f"o{i}/m{i}", "pipeline_tag": "text-generation"} for i in range(4)]
    captured = {}

    def fake(url, *, token=None, **kw):
        captured["params"] = kw.get("params")
        return rows

    monkeypatch.setattr(a, "_get_json", fake)
    page = a.search(page=2, page_size=2)
    assert captured["params"]["limit"] == 5  # 2*2+1
    assert "offset" not in captured["params"]  # 不再发 offset(HF 忽略)
    assert [c.model_id for c in page.items] == ["o2/m2", "o3/m3"]
    assert page.has_more is False  # rows 已用尽

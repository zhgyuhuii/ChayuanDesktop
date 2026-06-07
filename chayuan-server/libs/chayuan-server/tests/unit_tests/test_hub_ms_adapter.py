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


def test_readme_uses_repo_api_and_returns_text(monkeypatch):
    from chayuan.server.model_registry.hub_catalog.modelscope import ModelScopeAdapter
    a = ModelScopeAdapter()
    captured = {}

    def fake_get_text(url, *, token=None, **kw):
        captured["url"] = url
        captured["params"] = kw.get("params")
        return "# MS README"

    monkeypatch.setattr(a, "_get_text", fake_get_text)
    md = a.readme(model_id="qwen/Qwen2-0.5B-Instruct")
    assert md == "# MS README"
    assert captured["url"].endswith("/api/v1/models/qwen/Qwen2-0.5B-Instruct/repo")
    assert captured["params"]["Revision"] == "master"
    assert captured["params"]["FilePath"] == "README.md"


def test_readme_swallows_errors(monkeypatch):
    from chayuan.server.model_registry.hub_catalog.modelscope import ModelScopeAdapter
    a = ModelScopeAdapter()

    def boom(url, *, token=None, **kw):
        raise RuntimeError("404")

    monkeypatch.setattr(a, "_get_text", boom)
    assert a.readme(model_id="x/y") == ""


def test_search_pushes_tasks_criterion_for_capability(monkeypatch):
    # 指定 capability 必须把 tasks 过滤推到 dolphin 服务端(Criterion)。
    a = ModelScopeAdapter()
    captured = {}

    def fake(url, body, *, token=None, **kw):
        captured["body"] = body
        return {"Data": {"Model": {"Models": [], "TotalCount": 0}}}

    monkeypatch.setattr(a, "_put_json", fake)
    a.search(capability="rerank", page_size=5)
    assert captured["body"].get("Criterion") == [
        {"category": "tasks", "predicate": "contains", "values": ["text-ranking"]}
    ]


def test_search_trusts_server_filter_no_local_drop(monkeypatch):
    # 推了 Criterion 后信任服务端:即便某条 Tasks 归一为 other 也不本地丢。
    a = ModelScopeAdapter()
    rows = [
        {"Name": "m-emb", "Path": "o", "Tasks": [{"Name": "sentence-embedding"}],
         "LastUpdatedTime": 0},
        {"Name": "m-weird", "Path": "o", "Tasks": None, "LastUpdatedTime": 0},
    ]

    def fake(url, body, *, token=None, **kw):
        return {"Data": {"Model": {"Models": rows, "TotalCount": 169}}}

    monkeypatch.setattr(a, "_put_json", fake)
    page = a.search(capability="text-embedding", page_size=20)
    ids = [c.model_id for c in page.items]
    assert "o/m-emb" in ids
    assert "o/m-weird" in ids  # 服务端已筛,本地不再丢
    assert page.total == 169


@pytest.mark.parametrize("capability,expected_task", [
    ("chat", "text-generation"),
    ("text-embedding", "sentence-embedding"),
    ("rerank", "text-ranking"),
    ("speech-to-text", "auto-speech-recognition"),
    ("text-to-image", "text-to-image-synthesis"),  # 注意:MS 是 -synthesis,非 text-to-image
    ("text-to-video", "text-to-video-synthesis"),
    ("image-embedding", "multi-modal-embedding"),
])
def test_search_pushes_correct_ms_task_name(monkeypatch, capability, expected_task):
    # 锁定 capability -> MS dolphin task 名(实测各 TotalCount>0;名字写错会 0 结果空白)。
    a = ModelScopeAdapter()
    captured = {}

    def fake(url, body, *, token=None, **kw):
        captured["body"] = body
        return {"Data": {"Model": {"Models": [], "TotalCount": 0}}}

    monkeypatch.setattr(a, "_put_json", fake)
    a.search(capability=capability, page_size=5)
    assert captured["body"]["Criterion"] == [
        {"category": "tasks", "predicate": "contains", "values": [expected_task]}
    ]

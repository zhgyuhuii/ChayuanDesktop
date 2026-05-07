"""local_index 扫描 / 增量比对测试。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from chayuan.server.model_registry.local_index import (
    LocalModelEntry,
    LocalModelIndex,
    ScanDelta,
)


def _entry(mid: str, **kw) -> LocalModelEntry:
    return LocalModelEntry(
        model_id=mid,
        path=kw.get("path", f"/tmp/{mid}"),
        relpath=kw.get("relpath", mid),
        capability=kw.get("capability", "chat"),
        family=kw.get("family", ""),
        format=kw.get("format", "gguf"),
        size_bytes=int(kw.get("size_bytes", 1024)),
        mtime=float(kw.get("mtime", 1700000000)),
        confidence=float(kw.get("confidence", 0.9)),
        evidence=list(kw.get("evidence", [])),
        meta=dict(kw.get("meta", {})),
        source_tag=kw.get("source_tag", "models"),
    )


def test_replace_all_initial_all_added(tmp_path: Path):
    idx = LocalModelIndex(path=tmp_path / "local_models.json")
    delta = idx.replace_all([_entry("a"), _entry("b")])
    assert sorted(e.model_id for e in delta.added) == ["a", "b"]
    assert delta.updated == [] and delta.removed == []
    assert {e.model_id for e in idx.list_entries()} == {"a", "b"}


def test_replace_all_detects_updated_and_removed(tmp_path: Path):
    idx = LocalModelIndex(path=tmp_path / "local_models.json")
    idx.replace_all([_entry("a", size_bytes=100), _entry("b")])
    delta = idx.replace_all([
        _entry("a", size_bytes=200),  # size changed → updated
        _entry("c"),                  # new
    ])
    assert [e.model_id for e in delta.added] == ["c"]
    assert [e.model_id for e in delta.updated] == ["a"]
    assert delta.removed == ["b"]


def test_replace_all_no_change(tmp_path: Path):
    idx = LocalModelIndex(path=tmp_path / "local_models.json")
    items = [_entry("a", size_bytes=100, mtime=1700000000)]
    idx.replace_all(items)
    delta = idx.replace_all(items)
    assert not delta.changed


def test_persist_and_reload(tmp_path: Path):
    p = tmp_path / "local_models.json"
    idx = LocalModelIndex(path=p)
    idx.replace_all([_entry("a", capability="text-embedding")])
    # 直接读 JSON
    doc = json.loads(p.read_text(encoding="utf-8"))
    assert doc["items"][0]["capability"] == "text-embedding"
    # 再 new 一个 LocalModelIndex 应该能恢复同名 entry
    idx2 = LocalModelIndex(path=p)
    assert idx2.get("a") is not None


def test_by_capability(tmp_path: Path):
    idx = LocalModelIndex(path=tmp_path / "x.json")
    idx.replace_all([
        _entry("c1", capability="chat"),
        _entry("e1", capability="text-embedding"),
        _entry("c2", capability="chat"),
    ])
    chats = idx.by_capability("chat")
    assert sorted(e.model_id for e in chats) == ["c1", "c2"]


def test_scan_delta_changed_property():
    d = ScanDelta()
    assert not d.changed
    d.added.append(_entry("a"))
    assert d.changed

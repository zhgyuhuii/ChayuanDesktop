"""已安装集合 + search.installed 填充回归(P2 Task 2.2)。"""
from __future__ import annotations

import json

from chayuan.server.model_registry.hub_catalog.base import NormalizedModelCard
from chayuan.server.model_registry.hub_catalog.installed import (
    installed_repo_set,
    mark_installed,
)


def _write_manifest(model_dir, *, origin):
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    payload = {"version": 1, "source": "downloaded", "origin": origin,
               "files": [], "total_bytes": 0}
    (model_dir / ".chayuan-manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def test_installed_repo_set_reads_origin(tmp_path, monkeypatch):
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    _write_manifest(
        tmp_path / "models" / "bundled" / "chat" / "Qwen--X",
        origin={"source": "huggingface", "repo_id": "Qwen/X", "revision": "main"},
    )
    repo_set = installed_repo_set()
    assert ("huggingface", "Qwen/X") in repo_set


def test_installed_repo_set_fallback_dirname(tmp_path, monkeypatch):
    """无 origin 的老模型回退按目录名 owner--name → owner/name + unknown source。"""
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    _write_manifest(
        tmp_path / "models" / "bundled" / "embedding" / "BAAI--bge-m3",
        origin=None,
    )
    repo_set = installed_repo_set()
    assert ("unknown", "BAAI/bge-m3") in repo_set


def test_installed_repo_set_empty_when_no_models(tmp_path, monkeypatch):
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    assert installed_repo_set() == set()


def _card(source, model_id):
    return NormalizedModelCard(
        source=source, model_id=model_id, display_name=model_id,
        owner=model_id.split("/")[0], capability="chat",
    )


def test_mark_installed_exact_match():
    cards = [_card("huggingface", "Qwen/X"), _card("huggingface", "Other/Y")]
    mark_installed(cards, {("huggingface", "Qwen/X")})
    assert cards[0].installed is True
    assert cards[1].installed is False


def test_mark_installed_unknown_fallback_cross_source():
    """老模型记为 ('unknown', repo_id) 时,任意 source 的同 repo_id 卡片都标已装。"""
    cards = [_card("modelscope", "BAAI/bge-m3")]
    mark_installed(cards, {("unknown", "BAAI/bge-m3")})
    assert cards[0].installed is True


def test_mark_installed_empty_set_noop():
    cards = [_card("huggingface", "Qwen/X")]
    mark_installed(cards, set())
    assert cards[0].installed is False

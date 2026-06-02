"""卸载模型边界 + 解析回归(P2 Task 2.3)。"""
from __future__ import annotations

import types

from chayuan.server.model_registry import uninstall as uninstall_mod
from chayuan.server.model_registry.uninstall import (
    is_bundled_readonly,
    resolve_model_dir,
    uninstall,
)


class _FakeEntry:
    def __init__(self, path, *, source_tag="root", capability="chat",
                 model_id="models/bundled/chat/Qwen--X", size_bytes=123,
                 relpath=""):
        self.path = path
        self.source_tag = source_tag
        self.capability = capability
        self.model_id = model_id
        self.size_bytes = size_bytes
        self.relpath = relpath


class _FakeIndex:
    def __init__(self, entries):
        self._entries = entries

    def list_entries(self):
        return list(self._entries)


def _patch_index(monkeypatch, entries):
    fake = _FakeIndex(entries)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_index.get_local_index",
        lambda *a, **k: fake,
    )


# ── resolve_model_dir ─────────────────────────────────────────────

def test_resolve_model_dir_by_safe_name(tmp_path, monkeypatch):
    d = tmp_path / "models" / "bundled" / "chat" / "Qwen--X"
    d.mkdir(parents=True)
    _patch_index(monkeypatch, [_FakeEntry(str(d))])
    got = resolve_model_dir("huggingface", "Qwen/X")
    assert got is not None
    assert got.name == "Qwen--X"


def test_resolve_model_dir_not_found(tmp_path, monkeypatch):
    _patch_index(monkeypatch, [])
    assert resolve_model_dir("huggingface", "Nope/Z") is None


# ── is_bundled_readonly ───────────────────────────────────────────

def test_is_bundled_readonly():
    # 真实形态:source_tag='models'(顶层 models 根扫到),bundled 身份在 relpath 前缀。
    bundled = _FakeEntry("/x", source_tag="models",
                         relpath="bundled/chat/Qwen--X")
    assert is_bundled_readonly(bundled) is True
    normal = _FakeEntry("/y", source_tag="models", relpath="chat/Other--Y")
    assert is_bundled_readonly(normal) is False
    custom = _FakeEntry("/z", source_tag="custom", relpath="Qwen--X")
    assert is_bundled_readonly(custom) is False
    # 冗余兼容:历史/异常数据若真带 source_tag=='bundled' 也拒卸。
    legacy = _FakeEntry("/w", source_tag="bundled", relpath="")
    assert is_bundled_readonly(legacy) is True
    # str 入参兼容(relpath 字符串)
    assert is_bundled_readonly("bundled/chat/X") is True
    assert is_bundled_readonly("chat/X") is False


# ── uninstall 边界 ─────────────────────────────────────────────────

def test_uninstall_not_found(monkeypatch):
    _patch_index(monkeypatch, [])
    assert uninstall("huggingface", "Nope/Z") == {"ok": False, "reason": "not_found"}


def test_uninstall_bundled_rejected(tmp_path, monkeypatch):
    d = tmp_path / "models" / "bundled" / "chat" / "Qwen--X"
    d.mkdir(parents=True)
    # 真实形态:bundled 模型经顶层 models 根扫到 → source_tag='models',
    # bundled 身份只在 relpath 前缀 'bundled/'。拒卸必须据此前缀判定。
    _patch_index(monkeypatch, [_FakeEntry(
        str(d), source_tag="models", relpath="bundled/chat/Qwen--X")])
    res = uninstall("huggingface", "Qwen/X")
    assert res == {"ok": False, "reason": "bundled"}
    assert d.exists()  # 未删


def test_uninstall_in_use_without_force(tmp_path, monkeypatch):
    d = tmp_path / "models" / "bundled" / "chat" / "Qwen--X"
    d.mkdir(parents=True)
    mid = "models/bundled/chat/Qwen--X"
    _patch_index(monkeypatch, [_FakeEntry(str(d), capability="chat", model_id=mid)])

    fake_status = types.SimpleNamespace(state="ready", model_id=mid, endpoint=None)
    fake_mgr = types.SimpleNamespace(status=fake_status)
    fake_reg = types.SimpleNamespace(get=lambda cap: fake_mgr)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime_registry.get_registry",
        lambda: fake_reg,
    )
    res = uninstall("huggingface", "Qwen/X", force=False)
    assert res["ok"] is False
    assert res["reason"] == "in_use"
    assert res["capability"] == "chat"
    assert d.exists()  # 未删


def test_uninstall_success_deletes_and_rescans(tmp_path, monkeypatch):
    d = tmp_path / "models" / "custom" / "Qwen--X"
    d.mkdir(parents=True)
    (d / "config.json").write_text("{}", encoding="utf-8")
    mid = "custom/Qwen--X"
    _patch_index(monkeypatch, [_FakeEntry(str(d), source_tag="custom",
                                          capability="chat", model_id=mid,
                                          size_bytes=999)])
    # 没有 runtime(non-chat 走不到 stop);chat cap 但 status state=stopped → 不在用
    fake_status = types.SimpleNamespace(state="stopped", model_id=None, endpoint=None)
    fake_mgr = types.SimpleNamespace(status=fake_status)
    fake_reg = types.SimpleNamespace(get=lambda cap: fake_mgr)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime_registry.get_registry",
        lambda: fake_reg,
    )
    scanned = {"called": False}
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_index.scan_once",
        lambda *a, **k: scanned.update(called=True),
    )
    res = uninstall("huggingface", "Qwen/X")
    assert res["ok"] is True
    assert res["freed_bytes"] == 999
    assert not d.exists()  # 已删
    assert scanned["called"] is True


def test_uninstall_single_file_deletes_parent_dir(tmp_path, monkeypatch):
    """M1 回归:单文件模型 entry.path 指向文件,卸载应删其所在目录而非对文件 rmtree。"""
    d = tmp_path / "models" / "gguf" / "Qwen--X"
    d.mkdir(parents=True)
    f = d / "model.gguf"
    f.write_text("x", encoding="utf-8")
    # entry.path 指向单文件;resolve_model_dir 据父目录名匹配 'Qwen--X'。
    mid = "gguf/Qwen--X/model.gguf"
    _patch_index(monkeypatch, [_FakeEntry(
        str(f), source_tag="gguf", capability="chat", model_id=mid,
        relpath="Qwen--X/model.gguf", size_bytes=1)])
    fake_status = types.SimpleNamespace(state="stopped", model_id=None, endpoint=None)
    fake_mgr = types.SimpleNamespace(status=fake_status)
    fake_reg = types.SimpleNamespace(get=lambda cap: fake_mgr)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime_registry.get_registry",
        lambda: fake_reg,
    )
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_index.scan_once",
        lambda *a, **k: None,
    )
    res = uninstall("huggingface", "Qwen/X")
    assert res["ok"] is True  # 不抛 NotADirectoryError
    assert not f.exists()
    assert not d.exists()  # 整个模型目录被删

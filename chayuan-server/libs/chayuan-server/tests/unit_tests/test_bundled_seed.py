"""``model_registry.bundled_seed.seed_bundled_models`` 测试。"""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import pytest


@pytest.fixture
def chayuan_root_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    import chayuan.server.model_registry.local_index as li
    monkeypatch.setattr(li, "_SINGLETON", None)
    return tmp_path


@pytest.fixture
def bundled_source(tmp_path, monkeypatch):
    """在 tmp_path/bundled_source 下建一个最小 bundled_models 内容,并 monkey 到 env。"""
    src = tmp_path / "bundled_source"
    (src / "chat").mkdir(parents=True)
    (src / "embedding").mkdir(parents=True)
    (src / "rerank").mkdir(parents=True)
    (src / "asr").mkdir(parents=True)  # 故意空目录,验证空目录被跳过
    (src / "custom").mkdir(parents=True)

    (src / "chat" / "qwen3-4b.gguf").write_bytes(b"chat-model-binary")
    (src / "embedding" / "bge-m3.onnx").write_bytes(b"emb-onnx")
    # multi-file repo
    rerank_repo = src / "rerank" / "bge-reranker-base"
    rerank_repo.mkdir()
    (rerank_repo / "tokenizer.json").write_text("{}")
    (rerank_repo / "model.safetensors").write_bytes(b"rerank-weights")
    # custom + .gitkeep 占位
    (src / "custom" / ".gitkeep").write_text("")
    monkeypatch.setenv("CHAYUAN_BUNDLED_MODELS_DIR", str(src))
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    return src


def test_seed_copies_into_chayuan_root_models_bundled(chayuan_root_tmp, bundled_source):
    from chayuan.server.model_registry.bundled_seed import seed_bundled_models

    report = seed_bundled_models()

    target = chayuan_root_tmp / "models" / "bundled"
    assert report.source == str(bundled_source)
    assert report.target == str(target)
    assert (target / "chat" / "qwen3-4b.gguf").is_file()
    assert (target / "embedding" / "bge-m3.onnx").is_file()
    assert (target / "rerank" / "bge-reranker-base" / "tokenizer.json").is_file()
    assert (target / "rerank" / "bge-reranker-base" / "model.safetensors").is_file()

    # asr 是空目录(只有 .gitkeep + 普通空) -> 不在 target 出现
    assert not (target / "asr").exists()
    # custom 只有 .gitkeep -> 空目录 -> 同上
    assert not (target / "custom").exists()

    assert "bundled/chat/qwen3-4b.gguf" in report.copied
    assert "bundled/embedding/bge-m3.onnx" in report.copied
    assert report.errors == []


def test_seed_is_idempotent(chayuan_root_tmp, bundled_source):
    from chayuan.server.model_registry.bundled_seed import seed_bundled_models

    seed_bundled_models()
    second = seed_bundled_models()

    # 第二次:所有文件都已存在 size 匹配 -> 应该全部 skip,不 copy
    assert second.copied == [], f"second run should not copy, got {second.copied}"
    assert "bundled/chat/qwen3-4b.gguf" in second.skipped
    assert "bundled/embedding/bge-m3.onnx" in second.skipped


def test_seed_preserves_user_replacement(chayuan_root_tmp, bundled_source):
    """用户在 CHAYUAN_ROOT/models/bundled 下手动改过的文件,seed 不应覆盖。"""
    from chayuan.server.model_registry.bundled_seed import seed_bundled_models

    target = chayuan_root_tmp / "models" / "bundled"
    target.mkdir(parents=True, exist_ok=True)
    (target / "chat").mkdir(exist_ok=True)
    user_file = target / "chat" / "qwen3-4b.gguf"
    user_file.write_bytes(b"my-custom-replacement-bytes-XXX")
    # 让用户文件的 mtime 比 bundled 新
    later = time.time() + 100
    os.utime(user_file, (later, later))

    seed_bundled_models()

    assert user_file.read_bytes() == b"my-custom-replacement-bytes-XXX"


def test_seed_replaces_outdated_bundled_copy(chayuan_root_tmp, bundled_source):
    """目标存在但 size 不同 且 mtime 不比 bundled 新 -> 当作旧版 bundled 拷贝,允许替换。"""
    from chayuan.server.model_registry.bundled_seed import seed_bundled_models

    target = chayuan_root_tmp / "models" / "bundled" / "chat"
    target.mkdir(parents=True, exist_ok=True)
    old = target / "qwen3-4b.gguf"
    old.write_bytes(b"old")  # 比 bundled 短
    # 把 mtime 调到很久以前
    long_ago = time.time() - 86400
    os.utime(old, (long_ago, long_ago))

    report = seed_bundled_models()

    assert old.read_bytes() == b"chat-model-binary"
    assert "bundled/chat/qwen3-4b.gguf" in report.copied


def test_seed_returns_empty_report_when_source_missing(tmp_path, monkeypatch):
    """bundled_models_dir 找不到时,返回空 report,无异常。"""
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    monkeypatch.setenv("CHAYUAN_BUNDLED_MODELS_DIR", str(tmp_path / "nope"))
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    # 把 __file__ 改到一个 parents[5] 也找不到的位置
    import chayuan.server.model_registry.local_index as li
    fake = tmp_path / "fake" / "a" / "b" / "c" / "d" / "e"
    fake.mkdir(parents=True)
    monkeypatch.setattr(li, "__file__", str(fake / "local_index.py"))
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "fake" / "no-exe")])

    from chayuan.server.model_registry.bundled_seed import seed_bundled_models

    report = seed_bundled_models()
    assert report.source is None
    assert report.copied == []
    assert report.skipped == []
    assert report.errors == []


def test_seeded_files_appear_in_scan(chayuan_root_tmp, bundled_source):
    """seed -> scan_once 后,bundled 文件出现在 local_index 里,relpath 带 'bundled/' 前缀。"""
    from chayuan.server.model_registry.bundled_seed import seed_bundled_models
    from chayuan.server.model_registry.local_index import (
        get_local_index,
        scan_once,
    )

    seed_bundled_models()
    scan_once()

    idx = get_local_index()
    entries = idx.list_entries()
    relpaths = {e.relpath for e in entries}
    assert any(r.startswith("bundled/chat/qwen3-4b.gguf") for r in relpaths), relpaths
    assert any(r.startswith("bundled/embedding/bge-m3.onnx") for r in relpaths), relpaths


def test_seed_to_dict_is_json_safe(chayuan_root_tmp, bundled_source):
    import json
    from chayuan.server.model_registry.bundled_seed import seed_bundled_models

    report = seed_bundled_models()
    blob = json.dumps(report.to_dict())
    parsed = json.loads(blob)
    assert "source" in parsed
    assert "target" in parsed
    assert "copied" in parsed
    assert isinstance(parsed["copied"], list)

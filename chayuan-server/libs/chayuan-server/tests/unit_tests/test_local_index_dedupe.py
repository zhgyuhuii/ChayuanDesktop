"""LocalModelIndex 持久层去重回归。

血泪背景
--------
所有本地模型下拉(本地模型服务 /runtime/models、对话 ModelPicker /v1/models、
默认模型/脚本选模型 /admin/capability_defaults)最终都读 ``LocalModelIndex``。
``model_id = f"{source_tag}/{relpath}"`` 随"哪个扫描根先扫到"而变,同一物理模型
因此可能有两个不同 model_id(全路径前缀 vs 短前缀)。去重原来只在 ``scan_once``
内做,``_load`` / ``replace_all`` / ``list_entries`` 一律只按 model_id 当键 —— 历史
``local_models.json`` 里若已有两条同物理模型的记录,会被原样加载,导致每个下拉
都出现"一条路径、一条名称"的重复。

合同
----
* ``_load`` 读到的同一物理文件(realpath 相同)只保留一条;
* 同 capability + 同模型名(basename)的两份副本/两种根前缀也只保留一条;
* 保留的是"更全限定"的那条(与 scan_once 根顺序、/v1/models 去重保留可路由
  全路径条一致);
* 真正不同的模型(不同 basename、或不同 capability)不被误并。
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from chayuan.server.model_registry.local_index import (
    LocalModelEntry,
    LocalModelIndex,
)


def _write_index(entries):
    td = Path(tempfile.mkdtemp(prefix="chayuan-dedupe-test-"))
    p = td / "local_models.json"
    doc = {"version": 1, "items": [e.to_dict() for e in entries]}
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def test_load_collapses_same_physical_path_two_model_ids():
    """同一物理文件被两个根扫到(model_id 前缀不同)→ 只剩一条,保留全限定 id。"""
    same_path = "/data/models/modelscope/AI/bge-m3.gguf"
    p = _write_index([
        LocalModelEntry(
            model_id="models/modelscope/AI/bge-m3.gguf", path=same_path,
            relpath="modelscope/AI/bge-m3.gguf", capability="text-embedding",
            format="gguf", confidence=0.9,
        ),
        LocalModelEntry(
            model_id="modelscope/AI/bge-m3.gguf", path=same_path,
            relpath="AI/bge-m3.gguf", capability="text-embedding",
            format="gguf", confidence=0.9,
        ),
    ])
    idx = LocalModelIndex(p)
    items = idx.list_entries()
    assert len(items) == 1, f"应折叠成 1 条,实得 {[e.model_id for e in items]}"
    assert items[0].model_id == "models/modelscope/AI/bge-m3.gguf"


def test_load_collapses_same_cap_and_basename_two_copies():
    """两份磁盘副本(不同路径)同 capability 同文件名 → 只剩一条。"""
    p = _write_index([
        LocalModelEntry(
            model_id="models/bundled/chat/qwen3-4b.gguf",
            path="/data/models/bundled/chat/qwen3-4b.gguf",
            relpath="bundled/chat/qwen3-4b.gguf", capability="chat",
            format="gguf", confidence=0.8,
        ),
        LocalModelEntry(
            model_id="custom/qwen3-4b.gguf",
            path="/data/models/custom/qwen3-4b.gguf",
            relpath="qwen3-4b.gguf", capability="chat",
            format="gguf", confidence=0.8,
        ),
    ])
    idx = LocalModelIndex(p)
    items = idx.list_entries()
    assert len(items) == 1, f"同名同能力副本应折叠成 1 条,实得 {[e.model_id for e in items]}"


def test_load_keeps_genuinely_distinct_models():
    """不同模型(不同 basename)与不同能力的同名模型不被误并。"""
    p = _write_index([
        LocalModelEntry(
            model_id="models/chat/qwen3-4b.gguf", path="/data/models/chat/qwen3-4b.gguf",
            relpath="chat/qwen3-4b.gguf", capability="chat", format="gguf",
        ),
        LocalModelEntry(
            model_id="models/chat/llama3-8b.gguf", path="/data/models/chat/llama3-8b.gguf",
            relpath="chat/llama3-8b.gguf", capability="chat", format="gguf",
        ),
        LocalModelEntry(
            model_id="models/rerank/model.gguf", path="/data/models/rerank/model.gguf",
            relpath="rerank/model.gguf", capability="rerank", format="gguf",
        ),
        LocalModelEntry(
            model_id="models/embedding/model.gguf", path="/data/models/embedding/model.gguf",
            relpath="embedding/model.gguf", capability="text-embedding", format="gguf",
        ),
    ])
    idx = LocalModelIndex(p)
    items = idx.list_entries()
    assert len(items) == 4, f"不同模型不应折叠,实得 {[e.model_id for e in items]}"


def test_load_rewrites_persisted_file_when_dedup_removed_entries():
    """读时清掉历史脏重复后回写,持久文件自愈(下次/别处读也干净)。"""
    same_path = "/data/models/gguf/bge-m3.gguf"
    p = _write_index([
        LocalModelEntry(
            model_id="models/gguf/bge-m3.gguf", path=same_path,
            relpath="gguf/bge-m3.gguf", capability="text-embedding",
            format="gguf", confidence=0.9,
        ),
        LocalModelEntry(
            model_id="gguf/bge-m3.gguf", path=same_path,
            relpath="bge-m3.gguf", capability="text-embedding",
            format="gguf", confidence=0.9,
        ),
    ])
    LocalModelIndex(p)
    doc = json.loads(p.read_text(encoding="utf-8"))
    assert len(doc["items"]) == 1, "持久文件应被回写为去重后的 1 条"

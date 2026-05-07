"""5 级模型识别测试 — 用 tmp_path 构造各种"假模型仓库"。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

from chayuan.server.model_registry.identifier import identify_path


def _write(p: Path, content) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (dict, list)):
        p.write_text(json.dumps(content), encoding="utf-8")
    else:
        p.write_text(str(content), encoding="utf-8")


def test_level1_hf_config_chat(tmp_path: Path):
    repo = tmp_path / "Qwen2-7B-Instruct"
    _write(repo / "config.json", {"model_type": "qwen2", "hidden_size": 3584})
    ident = identify_path(repo)
    assert ident.capability == "chat"
    assert ident.format == "hf_transformers"
    assert ident.confidence >= 0.9
    assert ident.family == "qwen2"
    assert any("model_type=qwen2" in e for e in ident.evidence)


def test_level1_hf_config_bert_embedding(tmp_path: Path):
    repo = tmp_path / "bge-m3"
    _write(repo / "config.json", {"model_type": "bert", "hidden_size": 1024})
    ident = identify_path(repo)
    assert ident.capability == "text-embedding"
    assert ident.family == "bert"


def test_level2_diffusers_text_to_image(tmp_path: Path):
    repo = tmp_path / "SDXL-1.0"
    _write(repo / "model_index.json", {"_class_name": "StableDiffusionXLPipeline", "_diffusers_version": "0.30.0"})
    ident = identify_path(repo)
    assert ident.capability == "text-to-image"
    assert ident.format == "hf_diffusers"
    assert ident.family == "StableDiffusionXLPipeline"


def test_level3_gguf_single_file(tmp_path: Path):
    """构造一个**最小**合法 GGUF 头：magic + version + tensor_count + 1 个 string KV。"""
    p = tmp_path / "qwen3-4b-q4.gguf"
    out = bytearray()
    out += b"GGUF"
    out += struct.pack("<I", 3)            # version
    out += struct.pack("<Q", 0)            # tensor_count
    out += struct.pack("<Q", 1)            # kv_count
    key = "general.architecture".encode()
    out += struct.pack("<Q", len(key))
    out += key
    out += struct.pack("<I", 8)            # value_type=string
    val = b"qwen2"
    out += struct.pack("<Q", len(val))
    out += val
    p.write_bytes(bytes(out))
    ident = identify_path(p)
    assert ident.format == "gguf"
    assert ident.family == "qwen2"
    assert ident.capability == "chat"


def test_level4_card_pipeline_tag(tmp_path: Path):
    repo = tmp_path / "weird-asr"
    # 没有 config.json / model_index.json / gguf；走 card.json
    _write(repo / "card.json", {"pipeline_tag": "automatic-speech-recognition"})
    ident = identify_path(repo)
    assert ident.capability == "speech-to-text"
    assert ident.format == "unknown" or ident.format.startswith("hf")


def test_level4_readme_front_matter(tmp_path: Path):
    repo = tmp_path / "tts-model"
    (repo).mkdir()
    (repo / "README.md").write_text(
        "---\n"
        "language: zh\n"
        "pipeline_tag: text-to-speech\n"
        "---\n"
        "# Foo\n",
        encoding="utf-8",
    )
    ident = identify_path(repo)
    assert ident.capability == "text-to-audio"


def test_level5_path_hint_only(tmp_path: Path):
    p = tmp_path / "embed_models" / "mystery"
    p.mkdir(parents=True)
    (p / "weights.safetensors").write_text("dummy")  # 不构成有效模型，但应触发 path hint
    ident = identify_path(p)
    assert ident.capability == "text-embedding"  # "embed" hint
    assert ident.format == "safetensors"


def test_no_match_returns_other(tmp_path: Path):
    p = tmp_path / "no_idea"
    p.mkdir()
    ident = identify_path(p)
    assert ident.capability == "other"
    assert ident.confidence <= 0.3


def test_default_id_used(tmp_path: Path):
    p = tmp_path / "Qwen3-A"
    _write(p / "config.json", {"model_type": "qwen3"})
    ident = identify_path(p, default_id="huggingface/Qwen3-A")
    assert ident.model_id == "huggingface/Qwen3-A"

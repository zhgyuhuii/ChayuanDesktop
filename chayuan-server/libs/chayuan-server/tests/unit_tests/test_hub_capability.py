"""hub_catalog.capability 纯函数单测（不联网、无重依赖）。"""
from __future__ import annotations

import pytest

from chayuan.server.model_registry.hub_catalog.capability import (
    capability_from_hf_pipeline,
    capability_from_ms_tasks,
    is_runnable_format,
    parse_param_size,
)


@pytest.mark.parametrize(
    "pipeline,expected",
    [
        ("text-generation", "chat"),
        ("automatic-speech-recognition", "speech-to-text"),
        ("sentence-similarity", "text-embedding"),
        ("image-text-to-text", "image-to-text"),
        ("text-to-image", "text-to-image"),
        ("text-to-speech", "text-to-audio"),
        ("feature-extraction", "text-embedding"),
        (None, "other"),
        ("", "other"),
        ("totally-unknown-task", "other"),
    ],
)
def test_capability_from_hf_pipeline(pipeline, expected):
    assert capability_from_hf_pipeline(pipeline) == expected


def test_capability_from_ms_tasks_basic():
    tasks = [{"Name": "text-generation", "DomainName": "nlp"}]
    assert capability_from_ms_tasks(tasks) == "chat"


def test_capability_from_ms_tasks_vision():
    tasks = [{"Name": "image-text-to-text", "DomainName": "multi-modal"}]
    assert capability_from_ms_tasks(tasks) == "image-to-text"


def test_capability_from_ms_tasks_none_does_not_crash():
    # MS Tasks 可能为 None（实测），必须返回 other 而不抛。
    assert capability_from_ms_tasks(None) == "other"


def test_capability_from_ms_tasks_empty():
    assert capability_from_ms_tasks([]) == "other"


def test_capability_from_ms_tasks_skips_garbage():
    # 非 dict / 无 Name 的项要跳过而不崩。
    tasks = ["junk", {"NotName": "x"}, {"Name": "text-generation"}]
    assert capability_from_ms_tasks(tasks) == "chat"


@pytest.mark.parametrize(
    "model_id,expected",
    [
        ("Qwen/Qwen3-4B-GGUF", "4B"),
        ("Qwen/Qwen2.5-0.5B-Instruct", "0.5B"),
        ("BAAI/bge-reranker-v2-m3", None),
        ("meta-llama/Llama-3-70b", "70B"),
        ("some/model-1.5b-chat", "1.5B"),
        (None, None),
        ("", None),
    ],
)
def test_parse_param_size(model_id, expected):
    assert parse_param_size(model_id) == expected


@pytest.mark.parametrize(
    "exts,expected",
    [
        ([".gguf"], True),
        ([".onnx"], True),
        ([".safetensors"], False),
        ([".bin", ".json"], False),
        ([".SAFETENSORS", ".GGUF"], True),  # 大小写不敏感
        ([], False),
    ],
)
def test_is_runnable_format(exts, expected):
    assert is_runnable_format(exts) is expected

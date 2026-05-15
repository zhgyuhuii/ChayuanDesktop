"""resolve_infinity_args 分支测试 (Plan 3D)。"""
from __future__ import annotations

import pytest

from chayuan.server.model_registry import process_args


def _fake_entry(model_id, fmt, path):
    return type("Entry", (), {
        "model_id": model_id,
        "format": fmt,
        "path": path,
        "capability": "image",
    })()


def test_resolve_infinity_args_image_embedding_default(monkeypatch):
    """capability=image-embedding(默认)走 image default,args 含 -m + 模块名 + --model。"""
    e = _fake_entry("openai/clip-vit-base-patch32", "transformers", "/tmp/clip")
    monkeypatch.setattr(process_args, "_resolve", lambda cap, **kw: (e, ""))
    r = process_args.resolve_infinity_args()
    assert r.process == "infinity"
    assert "-m" in r.args
    assert "chayuan.server.image_source.infinity_server" in r.args
    assert "--model" in r.args
    assert "openai/clip-vit-base-patch32" in r.args
    assert r.resolved_models["image-embedding"] == "openai/clip-vit-base-patch32"


def test_resolve_infinity_args_unknown_capability_raises():
    """非 image-embedding 的 capability 抛 ValueError。"""
    with pytest.raises(ValueError, match="capability"):
        process_args.resolve_infinity_args(capability="chat")  # type: ignore[arg-type]


def test_resolve_infinity_args_missing_model_reports_image_embedding(monkeypatch):
    """模型未解到时 missing 列表里是 'image-embedding'(不是硬编码 chat)。"""
    monkeypatch.setattr(process_args, "_resolve", lambda cap, **kw: (None, "no image candidate"))
    r = process_args.resolve_infinity_args()
    assert "image-embedding" in r.missing
    assert r.reason == "no image candidate"

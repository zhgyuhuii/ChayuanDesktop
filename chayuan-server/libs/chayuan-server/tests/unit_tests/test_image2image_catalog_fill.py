"""_resolved_platforms 对「不可自动检测」的 image2image_models 回退 catalog 默认。

背景:图像编辑模型(qwen-image-edit 等)和视频模型一样不在 OpenAI /v1/models
自动检测里,DB 行往往为空 → 配了百炼也点不亮首页「图像编辑」。修复让
_resolved_platforms 对 text2video_models / image2image_models 两类空字段都回退
catalog 默认(原来只回退 text2video)。
"""
from __future__ import annotations

from chayuan.server import utils


def _patch(monkeypatch, row, version):
    monkeypatch.setattr(utils, "_merge_platforms", lambda *a, **k: [dict(row)])
    monkeypatch.setattr(utils, "_get_platform_version_safe", lambda: version)


def test_bailian_image2image_falls_back_to_catalog(monkeypatch):
    # 百炼启用,DB 行只有 llm,没有 image2image_models
    _patch(monkeypatch, {
        "platform_name": "bailian", "enabled": True, "llm_models": ["qwen-plus"],
    }, version=991001)
    plats = utils.get_config_platforms()
    assert "bailian" in plats
    i2i = plats["bailian"].get("image2image_models") or []
    assert "qwen-image-edit" in i2i, f"image2image 未回退 catalog: {i2i}"
    # 视频也照旧回退(回归保护)
    assert plats["bailian"].get("text2video_models"), "text2video 回退被破坏"


def test_explicit_image2image_not_overwritten(monkeypatch):
    # 用户已显式选了 image-edit 模型 → 不被 catalog 默认覆盖
    _patch(monkeypatch, {
        "platform_name": "bailian", "enabled": True,
        "image2image_models": ["qwen-image-edit-2509"],
    }, version=991002)
    plats = utils.get_config_platforms()
    assert plats["bailian"]["image2image_models"] == ["qwen-image-edit-2509"]

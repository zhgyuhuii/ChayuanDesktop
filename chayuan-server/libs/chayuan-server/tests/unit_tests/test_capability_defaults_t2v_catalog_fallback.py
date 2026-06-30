"""capability_defaults:启用厂商但 text2video 字段未落 DB 时,t2v 候选回退 catalog。

背景:ModelPlatformModel 没有 text2video_models 列,视频模型存不进厂商 DB,
导致默认模型页「文生视频」候选永远空。修复让 get_capability_defaults 对
text2video_models / image2image_models 字段空值回退 catalog 内置清单,
与 /model_platforms/catalog 的 _models_for 口径一致。
"""
from __future__ import annotations

import asyncio


def test_t2v_candidates_fall_back_to_catalog(monkeypatch):
    from chayuan.server.api_server import admin_routes as ar
    from chayuan.server.config_panel import runtime_framework_panel as rfp
    from chayuan.server.config_panel.model_config import PROVIDER_CATALOG
    from chayuan.server.db.repository import model_platform_repository as repo
    from chayuan.server.model_registry import candidates_bridge

    # 取一个 catalog 内置带文生视频默认的厂商
    meta = next(m for m in PROVIDER_CATALOG if (m.default_models or {}).get("text2video_models"))
    expected = list(meta.default_models["text2video_models"])

    # 该厂商启用,但 DB 行不含 text2video_models(模拟 ORM 无此列)
    monkeypatch.setattr(repo, "list_platforms", lambda: [{
        "enabled": True,
        "platform_type": meta.platform_type,
        "platform_name": meta.pid,
        "llm_models": [],
    }])
    monkeypatch.setattr(rfp, "_load_capability_defaults", lambda: {})
    monkeypatch.setattr(rfp, "_save_capability_default", lambda cap, mid: (True, "ok"))
    monkeypatch.setattr(candidates_bridge, "merge_local_into_candidates", lambda c, defaults=None: None)

    out = asyncio.run(ar.get_capability_defaults(_user=None))
    cands = out["data"]["candidates"]["t2v"]
    ids = [c["id"] for c in cands]
    assert expected[0] in ids, f"catalog 视频模型未回退进 t2v 候选: {ids}"
    assert any(c["platform_name"] == meta.pid for c in cands)


def test_t2v_empty_when_provider_disabled(monkeypatch):
    """厂商未启用时不回退(避免给没配 key 的厂商也塞候选)。"""
    from chayuan.server.api_server import admin_routes as ar
    from chayuan.server.config_panel import runtime_framework_panel as rfp
    from chayuan.server.config_panel.model_config import PROVIDER_CATALOG
    from chayuan.server.db.repository import model_platform_repository as repo
    from chayuan.server.model_registry import candidates_bridge

    meta = next(m for m in PROVIDER_CATALOG if (m.default_models or {}).get("text2video_models"))

    monkeypatch.setattr(repo, "list_platforms", lambda: [{
        "enabled": False,
        "platform_type": meta.platform_type,
        "platform_name": meta.pid,
    }])
    monkeypatch.setattr(rfp, "_load_capability_defaults", lambda: {})
    monkeypatch.setattr(rfp, "_save_capability_default", lambda cap, mid: (True, "ok"))
    monkeypatch.setattr(candidates_bridge, "merge_local_into_candidates", lambda c, defaults=None: None)

    out = asyncio.run(ar.get_capability_defaults(_user=None))
    assert out["data"]["candidates"]["t2v"] == []

"""capability_defaults:本地平台行里的 basename 别名不再产生重复候选。

背景(2026-07-18 根因):
``_register_local_platform``(local_runtime.py)自 2bf9f115 起给 ``local-<cap>``
DB 平台行的模型清单同时写入「local_index 全路径 model_id」和「basename 别名」
(别名用于让 ``get_config_models(basename)`` 命中本地平台,修 bge-m3
base_url=None)。但 ``get_capability_defaults`` 把平台行里每个 id 都平铺成一条
候选,且只按**精确 id** 去重 —— 于是每个本地模型都多出一条 basename 别名候选
(前端取 basename 显示,看起来是同名重复)。rerank 下载了几个模型就多几条。
之前的修复(ca293613)只治了 local_index 内部的重复,而别名根本不在 local_index
里,故未修好。

本测试锁定:同一物理模型(全路径 + basename 别名 + local_index 直出)在
candidates 里只出现一条,且用户已选的默认(可能存的是 basename)不被冲掉。
"""
from __future__ import annotations

import asyncio


def _basenames(cands):
    return [str(c["id"]).replace("\\", "/").rsplit("/", 1)[-1] for c in cands]


def test_local_alias_not_duplicated(monkeypatch):
    from chayuan.server.api_server import admin_routes as ar
    from chayuan.server.config_panel import runtime_framework_panel as rfp
    from chayuan.server.db.repository import model_platform_repository as repo
    from chayuan.server.model_registry import candidates_bridge as cb

    # local-<cap> DB 行:全路径 + basename 别名(_register_local_platform 的真实形状)
    monkeypatch.setattr(repo, "list_platforms", lambda: [
        {
            "enabled": True,
            "platform_type": "openai",
            "platform_name": "local-chat",
            "llm_models": ["models/bundled/chat/qwen3-4b.gguf", "qwen3-4b.gguf"],
        },
        {
            "enabled": True,
            "platform_type": "openai",
            "platform_name": "local-embedding",
            "embed_models": ["models/bundled/embedding/bge-m3", "bge-m3"],
        },
        {
            "enabled": True,
            "platform_type": "openai",
            "platform_name": "local-rerank",
            "rerank_models": [
                "models/bundled/rerank/bge-reranker-v2-m3.gguf",
                "models/bundled/rerank/jina-reranker-v1.gguf",
                "bge-reranker-v2-m3.gguf",
                "jina-reranker-v1.gguf",
            ],
        },
    ])
    # 用户此前已把默认嵌入设成 basename(KB 链路的历史真实存法)
    monkeypatch.setattr(rfp, "_load_capability_defaults", lambda: {"embedding": "bge-m3"})
    saved = {}
    monkeypatch.setattr(
        rfp, "_save_capability_default",
        lambda cap, mid: (saved.__setitem__(cap, mid) or (True, "ok")),
    )

    # local_index 直出(/runtime/models 同源):每个模型只有全路径一条
    _local = {
        "chat": [{
            "id": "models/bundled/chat/qwen3-4b.gguf", "runtime": "local",
            "platform_name": "local-chat", "format": "gguf", "size_bytes": 1,
            "is_default": False, "source": "local_index",
            "path": "/x/qwen3-4b.gguf", "family": "qwen",
        }],
        "embedding": [{
            "id": "models/bundled/embedding/bge-m3", "runtime": "local",
            "platform_name": "local-embedding", "format": "gguf", "size_bytes": 1,
            "is_default": False, "source": "local_index",
            "path": "/x/bge-m3", "family": "bge",
        }],
        "rerank": [
            {
                "id": "models/bundled/rerank/bge-reranker-v2-m3.gguf", "runtime": "local",
                "platform_name": "local-rerank", "format": "gguf", "size_bytes": 1,
                "is_default": False, "source": "local_index",
                "path": "/x/bge-reranker-v2-m3.gguf", "family": "bge",
            },
            {
                "id": "models/bundled/rerank/jina-reranker-v1.gguf", "runtime": "local",
                "platform_name": "local-rerank", "format": "gguf", "size_bytes": 1,
                "is_default": False, "source": "local_index",
                "path": "/x/jina-reranker-v1.gguf", "family": "jina",
            },
        ],
    }
    monkeypatch.setattr(
        cb, "local_candidates_for",
        lambda panel_cap, do_scan=True: [dict(c) for c in _local.get(panel_cap, [])],
    )

    out = asyncio.run(ar.get_capability_defaults(_user=None))
    cands = out["data"]["candidates"]

    # 每个物理模型只出现一条(前端按 basename 显示,不允许同名重复)
    for cap, expect_n in (("chat", 1), ("embedding", 1), ("rerank", 2)):
        bns = _basenames(cands[cap])
        assert len(bns) == len(set(bns)), f"{cap} 出现同名重复: {bns}"
        assert len(cands[cap]) == expect_n, f"{cap} 候选应为 {expect_n} 条, 实际 {cands[cap]}"

    # 已设默认(basename 存法)不被冲掉:embedding 默认仍指向 bge-m3 这个物理模型
    d = out["data"]["defaults"]["embedding"]
    assert d and d.replace("\\", "/").rsplit("/", 1)[-1] == "bge-m3", d
    # 且不应发生 embedding 的 auto 重设(默认仍有效)
    assert "embedding" not in saved, f"embedding 默认被意外重设: {saved}"
    # 保留下来的那条应带 is_default
    assert any(c.get("is_default") for c in cands["embedding"])


def test_merge_dedupes_platform_alias_and_prefix_mismatch():
    """merge_local_into_candidates 直测:别名 + 前缀不一致的全路径都折叠成一条。"""
    from chayuan.server.model_registry import candidates_bridge as cb

    candidates = {
        "chat": [
            # DB 平台行来的:全路径 + basename 别名
            {"id": "models/bundled/chat/qwen3-4b.gguf", "runtime": "openai",
             "platform_name": "local-chat", "is_default": False},
            {"id": "qwen3-4b.gguf", "runtime": "openai",
             "platform_name": "local-chat", "is_default": False},
            # 云厂商同名模型不能被误折叠
            {"id": "qwen3-4b.gguf", "runtime": "openai",
             "platform_name": "bailian", "is_default": False},
        ],
    }
    local = [{
        # local_index 直出,前缀与平台行不同(历史根前缀变更)
        "id": "custom/qwen3-4b.gguf", "runtime": "local",
        "platform_name": "local-chat", "format": "gguf", "size_bytes": 1,
        "is_default": False, "source": "local_index",
        "path": "/x/qwen3-4b.gguf", "family": "qwen",
    }]
    orig = cb.local_candidates_for
    cb.local_candidates_for = lambda panel_cap, do_scan=True: [dict(c) for c in local]
    try:
        cb.merge_local_into_candidates(candidates, defaults={})
    finally:
        cb.local_candidates_for = orig

    local_rows = [c for c in candidates["chat"]
                  if str(c.get("platform_name", "")).startswith("local")]
    cloud_rows = [c for c in candidates["chat"]
                  if not str(c.get("platform_name", "")).startswith("local")]
    assert len(local_rows) == 1, f"本地同物理模型应只剩一条: {local_rows}"
    # 保留可路由的全路径条(与 /v1/models、local_index _entry_preference 口径一致)
    assert "/" in local_rows[0]["id"]
    assert len(cloud_rows) == 1, "云厂商同名模型不能被折叠"

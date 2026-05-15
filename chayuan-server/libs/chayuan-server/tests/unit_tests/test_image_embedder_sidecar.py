"""image_source.embedder.get_embedder sidecar 优先 + fallback 测试 (Plan 3D)。"""
from __future__ import annotations

from unittest import mock

import pytest


def test_get_embedder_uses_sidecar_when_ready(monkeypatch):
    """sidecar image-embedding ready 时 get_embedder 返 InfinityHttpClient。"""
    from chayuan.server.image_source import embedder as emb
    from chayuan.server.model_registry import local_runtime as lr

    fake_mgr = mock.MagicMock()
    fake_mgr.status = lr.RuntimeStatus(state="ready", endpoint="http://127.0.0.1:62586", pid=88)

    fake_registry = mock.MagicMock()
    fake_registry.get = mock.MagicMock(return_value=fake_mgr)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime_registry.get_registry",
        lambda: fake_registry,
    )

    # mock InfinityHttpClient 构造,避免真实 httpx 客户端
    fake_client = mock.MagicMock()
    fake_client.name = "infinity@siglip2-base"
    fake_client.base_url = "http://127.0.0.1:62586"
    fake_ctor = mock.MagicMock(return_value=fake_client)
    monkeypatch.setattr(
        "chayuan.server.image_source.embedder_clients.infinity_http.InfinityHttpClient",
        fake_ctor,
    )

    result = emb.get_embedder("siglip2-base")
    # sidecar 命中 → 返 InfinityHttpClient (传入 base_url + model_id)
    fake_ctor.assert_called_once()
    call_kwargs = fake_ctor.call_args.kwargs
    assert call_kwargs.get("base_url") == "http://127.0.0.1:62586"
    assert call_kwargs.get("model_id") == "siglip2-base"
    assert result is fake_client


def test_get_embedder_falls_back_when_sidecar_stopped(monkeypatch):
    """sidecar stopped 时 get_embedder fallback 现有 Plan 1 路径。"""
    from chayuan.server.image_source import embedder as emb
    from chayuan.server.model_registry import local_runtime as lr

    fake_mgr = mock.MagicMock()
    fake_mgr.status = lr.RuntimeStatus(state="stopped")
    fake_registry = mock.MagicMock()
    fake_registry.get = mock.MagicMock(return_value=fake_mgr)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime_registry.get_registry",
        lambda: fake_registry,
    )

    # mock 现有 in-process 实现路径,验证它被调到
    fake_inproc = mock.MagicMock()
    fake_inproc.name = "inproc-fallback"
    monkeypatch.setattr(emb, "_get_inproc_embedder", mock.MagicMock(return_value=fake_inproc))

    result = emb.get_embedder("siglip2-base")
    assert result is fake_inproc


def test_get_embedder_falls_back_when_registry_exception(monkeypatch):
    """registry 抛异常时 fallback 不抛。"""
    from chayuan.server.image_source import embedder as emb

    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime_registry.get_registry",
        mock.MagicMock(side_effect=RuntimeError("registry crash")),
    )

    fake_inproc = mock.MagicMock()
    monkeypatch.setattr(emb, "_get_inproc_embedder", mock.MagicMock(return_value=fake_inproc))

    result = emb.get_embedder("clip-vit-base")
    assert result is fake_inproc

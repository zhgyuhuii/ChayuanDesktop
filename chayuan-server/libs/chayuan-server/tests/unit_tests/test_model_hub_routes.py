"""``model_hub_routes`` — /v1/model-hub/search|detail 端点 + 单源 502 隔离。

不联网：monkeypatch ``model_hub_routes._adapter`` 返回 stub 适配器，
只验证路由层协议适配（参数透传、pydantic 序列化、错误收敛）。
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from chayuan.server.api_server import model_hub_routes
from chayuan.server.api_server.model_hub_routes import model_hub_router
from chayuan.server.model_registry.hub_catalog import (
    HubFile,
    NormalizedModelCard,
    SearchPage,
)


def _card() -> NormalizedModelCard:
    return NormalizedModelCard(
        source="huggingface",
        model_id="Qwen/Qwen2.5-7B-Instruct-GGUF",
        display_name="Qwen2.5-7B-Instruct-GGUF",
        owner="Qwen",
        capability="chat",
        param_size="7B",
        format="gguf",
        runnable=True,
        downloads=123,
        likes=4,
    )


class _StubAdapter:
    """固定返回的 stub；记录最后一次调用入参便于断言透传。"""

    def __init__(self) -> None:
        self.last_search = None
        self.last_detail = None

    def search(self, **kwargs) -> SearchPage:
        self.last_search = kwargs
        return SearchPage(items=[_card()], page=1, page_size=20, has_more=False)

    def detail(self, **kwargs) -> list:
        self.last_detail = kwargs
        return [HubFile(rfilename="model.gguf", size_bytes=4096, runnable=True)]


class _BoomAdapter:
    def search(self, **kwargs) -> SearchPage:
        raise RuntimeError("connection refused")

    def detail(self, **kwargs) -> list:
        raise RuntimeError("connection refused")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(model_hub_router)
    return TestClient(app)


def test_search_ok(client, monkeypatch):
    stub = _StubAdapter()
    monkeypatch.setattr(model_hub_routes, "_adapter", lambda source: stub)

    resp = client.get("/v1/model-hub/search?source=huggingface&query=qwen&page=1")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body and "page" in body and "has_more" in body
    assert body["page"] == 1
    assert body["has_more"] is False
    assert len(body["items"]) == 1
    assert body["items"][0]["model_id"] == "Qwen/Qwen2.5-7B-Instruct-GGUF"
    # installed 此刻保持适配器默认 False（P2 才填）
    assert body["items"][0]["installed"] is False
    # 参数透传校验
    assert stub.last_search["query"] == "qwen"
    assert stub.last_search["page"] == 1


def test_search_bad_source_400(client, monkeypatch):
    # 不打桩 _adapter，走真实 _adapter 的未知 source 分支
    resp = client.get("/v1/model-hub/search?source=badsrc")
    assert resp.status_code == 400


def test_search_adapter_raises_502(client, monkeypatch):
    monkeypatch.setattr(model_hub_routes, "_adapter", lambda source: _BoomAdapter())
    resp = client.get("/v1/model-hub/search?source=huggingface&query=x")
    assert resp.status_code == 502
    assert "huggingface" in resp.json()["detail"]


def test_detail_ok(client, monkeypatch):
    stub = _StubAdapter()
    monkeypatch.setattr(model_hub_routes, "_adapter", lambda source: stub)

    resp = client.get("/v1/model-hub/detail?source=modelscope&model_id=a/b")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["rfilename"] == "model.gguf"
    assert body[0]["runnable"] is True
    assert stub.last_detail["model_id"] == "a/b"


def test_detail_bad_source_400(client, monkeypatch):
    resp = client.get("/v1/model-hub/detail?source=nope&model_id=a/b")
    assert resp.status_code == 400


def test_detail_adapter_raises_502(client, monkeypatch):
    monkeypatch.setattr(model_hub_routes, "_adapter", lambda source: _BoomAdapter())
    resp = client.get("/v1/model-hub/detail?source=modelscope&model_id=a/b")
    assert resp.status_code == 502
    assert "modelscope" in resp.json()["detail"]

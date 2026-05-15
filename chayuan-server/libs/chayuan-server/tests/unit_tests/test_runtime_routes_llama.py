"""``/runtime/llama/*`` 路由测试。

mock LlamaRuntimeManager,验证路由 → manager 方法的转发 + 响应 JSON 结构。
"""
from __future__ import annotations

from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from chayuan.server.api_server.runtime_routes import runtime_router
from chayuan.server.model_registry.local_runtime import RuntimeStatus


@pytest.fixture
def client(monkeypatch):
    fake = mock.MagicMock()
    fake.status = RuntimeStatus(state="ready", endpoint="http://127.0.0.1:62582", pid=1234)
    fake.start = mock.AsyncMock(return_value=fake.status)
    fake.stop = mock.AsyncMock(return_value=None)
    fake.restart = mock.AsyncMock(return_value=fake.status)
    monkeypatch.setattr(
        "chayuan.server.model_registry.local_runtime.get_manager",
        lambda: fake,
    )
    app = FastAPI()
    app.include_router(runtime_router)
    return TestClient(app), fake


def test_llama_status(client):
    c, _ = client
    r = c.get("/runtime/llama/status")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["state"] == "ready"
    assert data["endpoint"] == "http://127.0.0.1:62582"


def test_llama_start(client):
    c, fake = client
    r = c.post("/runtime/llama/start")
    assert r.status_code == 200
    fake.start.assert_called_once()


def test_llama_stop(client):
    c, fake = client
    r = c.post("/runtime/llama/stop")
    assert r.status_code == 200
    fake.stop.assert_called_once()


def test_llama_restart(client):
    c, fake = client
    r = c.post("/runtime/llama/restart")
    assert r.status_code == 200
    fake.restart.assert_called_once()

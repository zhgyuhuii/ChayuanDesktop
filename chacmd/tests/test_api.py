import pytest
from httpx import ASGITransport, AsyncClient

from chacmd.api.app import create_app
from chacmd.interfaces.db import Database


@pytest.fixture
async def client():
    db = Database(url="sqlite+aiosqlite:///:memory:")
    await db.create_all()
    app = create_app(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await db.dispose()


@pytest.mark.asyncio
async def test_openapi_served(client):
    resp = await client.get("/openapi.json")
    assert resp.status_code == 200
    assert "/api/v1/tasks/{code}/runs" in resp.json()["paths"]


@pytest.mark.asyncio
async def test_create_run_by_code_returns_job_id(client):
    resp = await client.post("/api/v1/tasks/world-rank-app/runs",
                             json={"goal": "build ranking app", "dept": "d1"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["job_id"]
    assert body["state"] == "queued"


@pytest.mark.asyncio
async def test_get_run_status(client):
    created = await client.post("/api/v1/tasks/c/runs", json={"goal": "g", "dept": "d1"})
    job_id = created.json()["job_id"]
    resp = await client.get(f"/api/v1/runs/{job_id}")
    assert resp.status_code == 200
    assert resp.json()["code"] == "c"


@pytest.mark.asyncio
async def test_list_containers(client):
    resp = await client.get("/api/v1/containers")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_anthropic_shim_endpoint():
    from chacmd.interfaces.chayuan_client import FakeChayuanClient

    db = Database(url="sqlite+aiosqlite:///:memory:")
    await db.create_all()
    app = create_app(db, chayuan=FakeChayuanClient())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/v1/messages", json={
            "model": "deepseek", "max_tokens": 50,
            "messages": [{"role": "user", "content": "hi"}],
        })
    assert r.status_code == 200
    body = r.json()
    assert body["content"][0]["type"] == "text"
    assert body["role"] == "assistant"
    await db.dispose()


@pytest.mark.asyncio
async def test_approve_moves_pending_to_running(client):
    created = await client.post("/api/v1/tasks/c/runs", json={"goal": "g", "dept": "d1"})
    job_id = created.json()["job_id"]
    await client.post(f"/api/v1/runs/{job_id}/_force_state", json={"state": "pending_approval"})
    r = await client.post(f"/api/v1/runs/{job_id}/approve")
    assert r.status_code == 200
    assert r.json()["state"] == "running"


@pytest.mark.asyncio
async def test_reject_moves_pending_to_cancelled(client):
    created = await client.post("/api/v1/tasks/c/runs", json={"goal": "g", "dept": "d1"})
    job_id = created.json()["job_id"]
    await client.post(f"/api/v1/runs/{job_id}/_force_state", json={"state": "pending_approval"})
    r = await client.post(f"/api/v1/runs/{job_id}/reject", json={"reason": "看着不对"})
    assert r.status_code == 200
    assert r.json()["state"] == "cancelled"


@pytest.mark.asyncio
async def test_approve_illegal_from_queued_returns_409(client):
    created = await client.post("/api/v1/tasks/c/runs", json={"goal": "g", "dept": "d1"})
    job_id = created.json()["job_id"]
    r = await client.post(f"/api/v1/runs/{job_id}/approve")  # queued→running 非法
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_shim_absent_when_chayuan_not_injected(client):
    # 未注入 chayuan（默认 create_app(db)）时不挂 shim 路由，保持向后兼容
    r = await client.post("/v1/messages", json={"model": "m", "max_tokens": 1, "messages": []})
    assert r.status_code == 404

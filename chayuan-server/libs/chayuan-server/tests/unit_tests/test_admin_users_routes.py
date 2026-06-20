from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.admin_users_routes import admin_users_router, _ADMIN


@pytest.fixture
def client():
    with session_scope() as s:
        s.query(MessageModel).delete(); s.query(UserModel).delete()
    svc.create_user("admin1", "secret123", role="admin")
    app = FastAPI()
    app.include_router(admin_users_router)
    app.dependency_overrides[_ADMIN] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def test_snapshot_route_200(client):
    r = client.get("/api/v1/admin/users/snapshot")
    assert r.status_code == 200
    b = r.json()
    assert b["total_users"] == 1 and isinstance(b["users"], list)
    assert "generated_at" in b and "total_tokens" in b

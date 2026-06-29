from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.dept_role_model import DeptRoleModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.orgs_routes import orgs_router, depts_router, _ADMIN as DADMIN
from chayuan.server.api_server.auth_routes import auth_router
from chayuan.server.auth.deps import get_current_user


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CHAYUAN_SEAT_DISABLED", "1")
    with session_scope() as s:
        for M in (DeptRoleModel, UserRoleModel, UserModel, DepartmentModel, OrganizationModel):
            s.query(M).delete()
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(orgs_router)
    app.include_router(depts_router)
    # admin 身份注入(auth_router 用 require_role("admin") = 依赖 get_current_user;
    # 直接覆盖 get_current_user 返回 admin dict)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1, "username": "admin1", "role": "admin"}
    app.dependency_overrides[DADMIN] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def _prefix(client):
    # auth_router 的 prefix(可能是 /auth)由实现决定;探测其一
    return ""


def test_create_user_with_dept_and_roles(client):
    # 建组织/部门
    org = client.post("/api/v1/admin/orgs", json={"name": "o", "code": "o"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "研发"}).json()["data"]
    r = client.post("/auth/users", json={"username": "zhang", "password": "secret123",
                                         "roles": ["user"], "dept_id": dept["id"]})
    assert r.status_code in (200, 201)
    body = r.json()
    assert body["dept_id"] == dept["id"]
    assert "user" in body["roles"]


def test_put_user_roles(client):
    r = client.post("/auth/users", json={"username": "li", "password": "secret123"})
    uid = r.json()["id"]
    r2 = client.put(f"/auth/users/{uid}/roles", json={"roles": ["user", "admin"]})
    assert r2.status_code == 200
    me = client.get("/auth/users").json()
    row = [u for u in me if u["id"] == uid][0]
    assert set(row["roles"]) == {"user", "admin"}


def test_patch_user_dept(client):
    org = client.post("/api/v1/admin/orgs", json={"name": "o2", "code": "o2"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "销售"}).json()["data"]
    uid = client.post("/auth/users", json={"username": "w", "password": "secret123"}).json()["id"]
    r = client.patch(f"/auth/users/{uid}/dept", json={"dept_id": dept["id"]})
    assert r.status_code == 200


def test_dept_roles_endpoint(client):
    org = client.post("/api/v1/admin/orgs", json={"name": "o3", "code": "o3"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "x"}).json()["data"]
    r = client.put(f"/api/v1/admin/depts/{dept['id']}/roles",
                   json={"roles": [{"role_name": "user", "include_subtree": True}]})
    assert r.status_code == 200
    got = client.get(f"/api/v1/admin/depts/{dept['id']}/roles").json()["data"]["roles"]
    assert got[0]["role_name"] == "user" and got[0]["include_subtree"] is True


def test_dept_members_endpoint(client):
    org = client.post("/api/v1/admin/orgs", json={"name": "o4", "code": "o4"}).json()["data"]
    dept = client.post("/api/v1/admin/depts", json={"org_id": org["id"], "name": "m"}).json()["data"]
    client.post("/auth/users", json={"username": "mem1", "password": "secret123", "dept_id": dept["id"]})
    r = client.get(f"/api/v1/admin/depts/{dept['id']}/members")
    assert r.status_code == 200
    members = r.json()["data"]["members"]
    assert any(m["username"] == "mem1" for m in members)

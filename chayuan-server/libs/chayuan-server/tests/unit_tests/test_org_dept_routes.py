from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.orgs_routes import orgs_router, depts_router, _ADMIN


@pytest.fixture
def client():
    with session_scope() as s:
        s.query(DepartmentModel).delete()
        s.query(OrganizationModel).delete()
    app = FastAPI()
    app.include_router(orgs_router)
    app.include_router(depts_router)
    app.dependency_overrides[_ADMIN] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def test_org_crud_flow(client):
    r = client.post("/api/v1/admin/orgs", json={"name": "总公司", "code": "hq"})
    assert r.status_code == 200
    org_id = r.json()["data"]["id"]
    assert any(o["code"] == "hq" for o in client.get("/api/v1/admin/orgs").json()["data"]["orgs"])
    r = client.patch(f"/api/v1/admin/orgs/{org_id}", json={"name": "总公司改"})
    assert r.json()["data"]["name"] == "总公司改"
    assert client.delete(f"/api/v1/admin/orgs/{org_id}").status_code == 200


def test_create_org_duplicate_code_400(client):
    client.post("/api/v1/admin/orgs", json={"name": "A", "code": "dup"})
    assert client.post("/api/v1/admin/orgs", json={"name": "B", "code": "dup"}).status_code == 400


def test_dept_tree_via_routes(client):
    org_id = client.post("/api/v1/admin/orgs", json={"name": "X", "code": "x"}).json()["data"]["id"]
    root = client.post("/api/v1/admin/depts", json={"org_id": org_id, "name": "总部"}).json()["data"]
    client.post("/api/v1/admin/depts", json={"org_id": org_id, "parent_id": root["id"], "name": "研发部"})
    tree = client.get(f"/api/v1/admin/depts?org_id={org_id}").json()["data"]["tree"]
    assert tree[0]["children"][0]["name"] == "研发部"


def test_dept_move_via_routes(client):
    org_id = client.post("/api/v1/admin/orgs", json={"name": "X", "code": "mv"}).json()["data"]["id"]
    a = client.post("/api/v1/admin/depts", json={"org_id": org_id, "name": "A"}).json()["data"]
    b = client.post("/api/v1/admin/depts", json={"org_id": org_id, "name": "B"}).json()["data"]
    child = client.post("/api/v1/admin/depts", json={"org_id": org_id, "parent_id": a["id"], "name": "C"}).json()["data"]
    r = client.post(f"/api/v1/admin/depts/{child['id']}/move", json={"new_parent_id": b["id"]})
    assert r.status_code == 200 and r.json()["data"]["parent_id"] == b["id"]

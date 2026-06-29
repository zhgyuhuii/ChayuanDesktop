from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope
from chayuan.server.api_server.kb_acl_routes import kb_acl_router


@pytest.fixture
def client():
    with session_scope() as s:
        s.query(KbSubjectGrantModel).delete()
    app = FastAPI()
    app.include_router(kb_acl_router)
    return TestClient(app)


def test_add_role_grant_and_list(client):
    r = client.post("/api/v1/admin/kb-acl/1/grants",
                    json={"subject_type": "role", "subject_id": "sales", "role": "editor"})
    assert r.status_code == 200
    g = client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"]
    assert any(x["subject_type"] == "role" and x["subject_id"] == "sales" and x["role"] == "editor" for x in g)


def test_add_dept_grant_with_subtree(client):
    r = client.post("/api/v1/admin/kb-acl/1/grants",
                    json={"subject_type": "dept", "subject_id": "3", "role": "reader", "include_subtree": True})
    assert r.status_code == 200
    g = client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"]
    row = [x for x in g if x["subject_type"] == "dept"][0]
    assert row["include_subtree"] is True


def test_revoke_by_subject(client):
    client.post("/api/v1/admin/kb-acl/1/grants",
                json={"subject_type": "role", "subject_id": "sales", "role": "reader"})
    r = client.delete("/api/v1/admin/kb-acl/1/grants?subject_type=role&subject_id=sales")
    assert r.status_code == 200
    assert client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"] == []


def test_legacy_user_grant_still_works(client):
    # 兼容:只传 user_id 也能授(映射成 subject_type=user)
    r = client.post("/api/v1/admin/kb-acl/1/grants", json={"user_id": 7, "role": "reader"})
    assert r.status_code == 200
    g = client.get("/api/v1/admin/kb-acl/1/grants").json()["data"]["grants"]
    assert any(x["subject_type"] == "user" and x["subject_id"] == "7" for x in g)

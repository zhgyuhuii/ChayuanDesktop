from __future__ import annotations
import pytest
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import org_repository as orgs


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(DepartmentModel).delete()
            s.query(OrganizationModel).delete()
    _purge(); yield; _purge()


def _new_org(code="t1"):
    return orgs.create_org("测试组织", code)


def test_create_and_list_org():
    o = _new_org()
    assert o["code"] == "t1"
    assert any(r["id"] == o["id"] for r in orgs.list_orgs())


def test_duplicate_org_code_rejected():
    _new_org("dup")
    with pytest.raises(ValueError):
        _new_org("dup")


def test_update_org():
    o = _new_org("up")
    got = orgs.update_org(o["id"], name="改名了")
    assert got["name"] == "改名了"

from __future__ import annotations
import pytest
from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope
from chayuan.server.db.repository import kb_grant_repository as kg


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(KbSubjectGrantModel).delete()
    _purge(); yield; _purge()


def test_add_and_list_user_grant():
    kg.add_grant(1, "user", "5", "reader", granted_by=9)
    rows = kg.list_grants(1)
    assert len(rows) == 1
    assert rows[0]["subject_type"] == "user" and rows[0]["subject_id"] == "5" and rows[0]["role"] == "reader"


def test_add_upserts_role():
    kg.add_grant(1, "dept", "3", "reader", include_subtree=True)
    kg.add_grant(1, "dept", "3", "editor", include_subtree=True)  # 同主体再授 → 升级
    rows = kg.list_grants(1)
    assert len(rows) == 1 and rows[0]["role"] == "editor" and rows[0]["include_subtree"] is True


def test_revoke_grant():
    kg.add_grant(1, "role", "mgr", "editor")
    kg.revoke_grant(1, "role", "mgr")
    assert kg.list_grants(1) == []


def test_invalid_role_rejected():
    with pytest.raises(ValueError):
        kg.add_grant(1, "user", "5", "owner")


def test_invalid_subject_type_rejected():
    with pytest.raises(ValueError):
        kg.add_grant(1, "group", "5", "reader")

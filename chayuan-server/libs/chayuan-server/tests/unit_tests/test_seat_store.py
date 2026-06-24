from __future__ import annotations

sqlalchemy = pytest = None  # forward ref placeholders

import pytest

sqlalchemy = pytest.importorskip("sqlalchemy")  # 本沙箱无 sqlalchemy → skip;真机才跑

from chayuan.server.db.session import session_scope
from chayuan.server.db.models.deployment_identity_model import DeploymentIdentityModel


@pytest.fixture(autouse=True)
def _clean_row():
    def _purge():
        with session_scope() as s:
            s.query(DeploymentIdentityModel).delete()
    _purge(); yield; _purge()


def test_model_roundtrip():
    with session_scope() as s:
        s.add(DeploymentIdentityModel(key="deployment", fingerprint="abc123", license_json=None))
    with session_scope() as s:
        row = s.get(DeploymentIdentityModel, "deployment")
        assert row is not None and row.fingerprint == "abc123"

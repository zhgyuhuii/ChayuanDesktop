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

from chayuan.server.license import seat_store


def test_fresh_init_generates_stable_fp(tmp_path):
    fp1 = seat_store.get_fingerprint(tmp_path)
    fp2 = seat_store.get_fingerprint(tmp_path)
    assert fp1 and fp1 == fp2
    assert len(fp1) == 32


def test_migrate_imports_old_id_file(tmp_path):
    import json
    (tmp_path / "deployment_id.json").write_text(json.dumps({"fp": "deadbeef" * 4}), encoding="utf-8")
    assert seat_store.get_fingerprint(tmp_path) == "deadbeef" * 4


def test_migrate_imports_old_license_file(tmp_path):
    import json
    (tmp_path / "deployment_id.json").write_text(json.dumps({"fp": "ab" * 16}), encoding="utf-8")
    (tmp_path / "deployment_license.json").write_text(
        json.dumps({"maxUsers": 7, "expireAt": 9999999999, "fp": "ab" * 16}), encoding="utf-8")
    lic = seat_store.read_license(tmp_path)
    assert lic and lic["maxUsers"] == 7


def test_write_then_read_license(tmp_path):
    seat_store.write_license(tmp_path, {"maxUsers": 5, "expireAt": 9999999999, "fp": "x"})
    lic = seat_store.read_license(tmp_path)
    assert lic and lic["maxUsers"] == 5


def test_idempotent_does_not_overwrite(tmp_path):
    fp1 = seat_store.get_fingerprint(tmp_path)
    seat_store.get_fingerprint(tmp_path)
    with session_scope() as s:
        assert s.query(DeploymentIdentityModel).count() == 1
        assert s.get(DeploymentIdentityModel, "deployment").fingerprint == fp1


def test_single_machine_uses_file_not_db(tmp_path, monkeypatch):
    from chayuan.server.license import seat
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    fp = seat.deployment_fingerprint(tmp_path)
    assert fp and len(fp) == 32
    assert (tmp_path / "deployment_id.json").exists()        # 单机写了文件
    with session_scope() as s:                               # 单机没碰 DB 表
        assert s.query(DeploymentIdentityModel).count() == 0

def test_network_uses_db_not_file(tmp_path, monkeypatch):
    from chayuan.server.license import seat
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    fp = seat.deployment_fingerprint(tmp_path)
    assert fp
    assert not (tmp_path / "deployment_id.json").exists()    # 网络版不写文件
    with session_scope() as s:
        assert s.query(DeploymentIdentityModel).count() == 1

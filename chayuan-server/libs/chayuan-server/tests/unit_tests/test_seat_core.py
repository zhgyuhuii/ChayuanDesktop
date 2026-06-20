from __future__ import annotations
import json, time
from pathlib import Path
import pytest
from chayuan.server.license import seat


def test_fingerprint_stable(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    fp1 = seat.deployment_fingerprint(tmp_path)
    fp2 = seat.deployment_fingerprint(tmp_path)
    assert fp1 and fp1 == fp2
    assert (tmp_path / "deployment_id.json").is_file()


def test_single_machine_unlimited(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    assert seat.effective_max_users(tmp_path) is None


def test_network_default_10(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.delenv("CHAYUAN_SEAT_DISABLED", raising=False)
    assert seat.effective_max_users(tmp_path) == 10


def test_network_with_license(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    seat.write_deployment_license(
        tmp_path, {"maxUsers": 100, "expireAt": time.time() + 3600, "fp": "x"}
    )
    assert seat.effective_max_users(tmp_path) == 100


def test_expired_license_falls_back_10(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    seat.write_deployment_license(
        tmp_path, {"maxUsers": 100, "expireAt": time.time() - 1, "fp": "x"}
    )
    assert seat.effective_max_users(tmp_path) == 10


def test_kill_switch_unlimited(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.setenv("CHAYUAN_SEAT_DISABLED", "1")
    assert seat.effective_max_users(tmp_path) is None

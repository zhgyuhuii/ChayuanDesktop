from __future__ import annotations
import base64, json, time
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from chayuan.server.license import seat


def _sign_token(payload: dict, priv: Ed25519PrivateKey) -> str:
    msg = json.dumps(payload).encode("utf-8")
    sig = priv.sign(msg)
    b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
    return f"{b(msg)}.{b(sig)}"


@pytest.fixture
def keypair():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    return priv, pub


def test_activate_ok(tmp_path, monkeypatch, keypair):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    priv, pub = keypair
    fp = seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": fp, "exp": time.time() + 3600}, priv
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is True and res["maxUsers"] == 100
    assert seat.effective_max_users(tmp_path) == 100


def test_activate_wrong_fp_rejected(tmp_path, keypair):
    priv, pub = keypair
    seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": "OTHER", "exp": time.time() + 3600}, priv
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is False and res.get("reason") == "fp-mismatch"


def test_activate_expired_rejected(tmp_path, keypair):
    priv, pub = keypair
    fp = seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": fp, "exp": time.time() - 1}, priv
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is False and res.get("reason") == "expired"


def test_activate_bad_signature_rejected(tmp_path, keypair):
    priv, pub = keypair
    other = Ed25519PrivateKey.generate()
    fp = seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": fp, "exp": time.time() + 3600}, other
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is False and res.get("reason") == "bad-signature"

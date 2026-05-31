from chayuan.server.license import entcode
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

PAYLOAD = {
    "v": 1, "id": "deadbeefdeadbeef", "src": "promo", "mid": None,
    "cardExpireAt": "2026-12-31T00:00:00.000Z",
    "grants": [{"app": "video", "kind": "time", "days": 30},
               {"app": "chat", "kind": "count", "n": 100}],
}


def test_verify_valid_code_returns_payload():
    code = sign_entcode(PAYLOAD)
    r = entcode.verify(code, public_key_bytes())
    assert r["valid"] is True
    assert r["payload"]["id"] == "deadbeefdeadbeef"
    assert r["payload"]["grants"][1]["n"] == 100


def test_tampered_code_rejected():
    code = sign_entcode(PAYLOAD)
    bad = code[:-2] + ("AA" if not code.endswith("AA") else "BB")
    assert entcode.verify(bad, public_key_bytes())["valid"] is False


def test_wrong_key_rejected():
    code = sign_entcode(PAYLOAD)
    assert entcode.verify(code, b"\x00" * 32)["valid"] is False


def test_validate_payload_shape():
    assert entcode.validate_payload(PAYLOAD) is None
    assert entcode.validate_payload({"grants": "nope"}) == "shape"
    assert entcode.validate_payload({"grants": [{"app": "x", "kind": "weird"}]}) == "grant-kind"
    assert entcode.validate_payload({"grants": [{"kind": "count", "n": 1}]}) == "grant-app"

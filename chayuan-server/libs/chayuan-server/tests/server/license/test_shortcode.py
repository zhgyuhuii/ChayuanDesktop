from chayuan.server.license.shortcode import verify_shortcode

KEY = bytes.fromhex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
FP = bytes.fromhex("1122334455667788")
SERIAL = "2101W-0JWN1-MN2JP-9V4QW-MSGJ"
KEYS = {1: KEY}

def test_golden_serial_verifies():
    r = verify_shortcode(SERIAL, FP, KEYS)
    assert r["valid"] is True
    assert r["fields"]["durDays"] == 30
    assert r["expireAt"] == "2026-07-01T00:00:00.000Z"

def test_wrong_machine_fails():
    r = verify_shortcode(SERIAL, bytes.fromhex("8877665544332211"), KEYS)
    assert r["valid"] is False and r["reason"] == "signature"

def test_tampered_checksum():
    nd = SERIAL.replace("-", "")
    flipped = ("B" if nd[0] == "A" else "A") + nd[1:]
    r = verify_shortcode(flipped, FP, KEYS)
    assert r["valid"] is False and r["reason"] == "checksum"

def test_unknown_key_version():
    r = verify_shortcode(SERIAL, FP, {})
    assert r["valid"] is False and r["reason"] == "unknown-key"

def test_lowercase_and_no_dash():
    r = verify_shortcode(SERIAL.replace("-", "").lower(), FP, KEYS)
    assert r["valid"] is True

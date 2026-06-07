from chayuan.server.license.shortcode import verify_shortcode

KEY = bytes.fromhex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
FP = bytes.fromhex("1122334455667788")
KEYS = {1: KEY}

# 跨语言金标:由 website server/license/shortcode.js 的 sign() 用同样 KEY/FP 产出。
# 两侧字节一致的护栏——改 codec/base32/HMAC 任一处都会让这两条断言失败。
TIME_SERIAL = "20407-G4Q00-50485-11B32-AM84"   # ver1 kind0 modules1 value30 issueDate151 nonce0
COUNT_SERIAL = "3080C-G0002-JZ6XA-79BJG-YER6"  # ver1 kind1 modules2 value50


def test_time_serial_verifies():
    r = verify_shortcode(TIME_SERIAL, FP, KEYS)
    assert r["valid"] is True
    assert r["fields"]["kind"] == 0
    assert r["fields"]["modules"] == 1
    assert r["fields"]["value"] == 30
    assert r["expireAt"] == "2026-07-01T00:00:00.000Z"


def test_count_serial_no_expire():
    # 旧断言保留历史记录:此测试已由 test_count_serial_has_expire 取代。
    # kind=1 次数型现在携带 expireAt(issueDate + COUNT_VALID_DAYS)。
    r = verify_shortcode(COUNT_SERIAL, FP, KEYS)
    assert r["valid"] is True
    assert r["fields"]["kind"] == 1
    assert r["fields"]["value"] == 50
    assert r["fields"]["modules"] == 2
    assert "expireAt" in r  # P3:次数型现在有到期


def test_wrong_machine_fails():
    r = verify_shortcode(TIME_SERIAL, bytes.fromhex("8877665544332211"), KEYS)
    assert r["valid"] is False and r["reason"] == "signature"


def test_tampered_checksum():
    nd = TIME_SERIAL.replace("-", "")
    flipped = nd[:23] + ("B" if nd[23] == "A" else "A")
    r = verify_shortcode(flipped, FP, KEYS)
    assert r["valid"] is False and r["reason"] == "checksum"


def test_unknown_key_version():
    r = verify_shortcode(TIME_SERIAL, FP, {})
    assert r["valid"] is False and r["reason"] == "unknown-key"


def test_lowercase_and_no_dash():
    r = verify_shortcode(TIME_SERIAL.replace("-", "").lower(), FP, KEYS)
    assert r["valid"] is True


from chayuan.server.license.codec import COUNT_VALID_DAYS


def test_count_serial_has_expire():
    r = verify_shortcode(COUNT_SERIAL, FP, KEYS)
    assert r["valid"] is True
    assert r["fields"]["kind"] == 1
    assert "expireAt" in r
    # issueDate=0 => EPOCH(2026-01-01) + COUNT_VALID_DAYS(30) = 2026-01-31
    assert r["expireAt"] == "2026-01-31T00:00:00.000Z"

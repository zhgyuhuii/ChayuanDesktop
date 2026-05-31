from chayuan.server.license import engine, entstore
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

T0 = 1780000000.0


def _cfg():
    return {"daily_free": {"video": 2, "chat": 10}, "public_key": public_key_bytes(), "hmac_keys": {}}


def _code(grants, code_id="id0001", mid=None, card_exp=None):
    return sign_entcode({"v": 1, "id": code_id, "src": "promo", "mid": mid,
                         "cardExpireAt": card_exp, "grants": grants})


def test_redeem_multi_grant_applies_count_and_time(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5},
                  {"app": "chat", "kind": "time", "days": 30}])
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is True
    assert entstore.read_state(tmp_path, "video")["counts"] == 5
    chat = entstore.read_state(tmp_path, "chat")
    assert chat["timeExpireAt"] is not None
    assert engine._ts(chat["timeExpireAt"]) > T0


def test_redeem_count_accumulates(tmp_path):
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "count", "n": 5}], code_id="a"), _cfg(), now=T0)
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "count", "n": 3}], code_id="b"), _cfg(), now=T0)
    assert entstore.read_state(tmp_path, "video")["counts"] == 8


def test_redeem_time_stacks_on_existing(tmp_path):
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "time", "days": 10}], code_id="a"), _cfg(), now=T0)
    exp1 = engine._ts(entstore.read_state(tmp_path, "video")["timeExpireAt"])
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "time", "days": 10}], code_id="b"), _cfg(), now=T0)
    exp2 = engine._ts(entstore.read_state(tmp_path, "video")["timeExpireAt"])
    assert round(exp2 - exp1) == 10 * 86400  # 叠加 10 天


def test_redeem_same_code_twice_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}], code_id="dup")
    assert engine.redeem(tmp_path, code, _cfg(), now=T0)["ok"] is True
    r2 = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r2["ok"] is False and r2["reason"] == "used"
    assert entstore.read_state(tmp_path, "video")["counts"] == 5  # 不重复加


def test_redeem_card_expired_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}], card_exp="2020-01-01T00:00:00.000Z")
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "card-expired"


def test_redeem_bad_signature_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}])
    r = engine.redeem(tmp_path, code[:-2] + "ZZ", _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "signature"


def test_redeem_mid_mismatch_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}], mid="ffffffffffffffff")
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "mismatch"


import hmac as _hmac
import hashlib as _hashlib


def test_redeem_shortcode_sets_time(monkeypatch, tmp_path):
    # 用 stub 的 verify_shortcode 返回到期,验证 engine 把它写进 entstore。
    from chayuan.server.license import engine as eng

    def fake_verify(serial, machine_fp, hmac_keys):
        return {"valid": True, "reason": None, "fields": {"app": 1}, "expireAt": "2099-01-01T00:00:00.000Z"}

    monkeypatch.setattr(eng, "verify_shortcode", fake_verify)
    r = eng.redeem_shortcode(tmp_path, "2101W-0JWN1-MN2JP-9V4QW-MSGJ", "video", _cfg(), now=T0)
    assert r["ok"] is True
    assert entstore.read_state(tmp_path, "video")["timeExpireAt"] == "2099-01-01T00:00:00.000Z"


def test_redeem_shortcode_invalid_rejected(monkeypatch, tmp_path):
    from chayuan.server.license import engine as eng
    monkeypatch.setattr(eng, "verify_shortcode", lambda *a, **k: {"valid": False, "reason": "checksum"})
    r = eng.redeem_shortcode(tmp_path, "BAD", "video", _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "checksum"

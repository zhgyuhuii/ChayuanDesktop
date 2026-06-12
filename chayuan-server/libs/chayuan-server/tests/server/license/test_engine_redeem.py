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


def _scfg(products=None):
    return {**_cfg(), "products": products or {"video": 0, "ocr": 1}}


def test_redeem_shortcode_sets_time(monkeypatch, tmp_path):
    # stub verify_shortcode 返回 kind=0 + 位图,验证 engine 按位图展开累加 value 天。
    # (改累加后:到期 = now + value*86400,不再用 expireAt 绝对时间)
    from chayuan.server.license import engine as eng

    def fake_verify(serial, machine_fp, hmac_keys):
        return {"valid": True, "fields": {"kind": 0, "modules": 0b1, "value": 1,
                                          "issueDate": 0, "nonce": 0, "ver": 1},
                "expireAt": "2099-01-01T00:00:00.000Z"}

    monkeypatch.setattr(eng, "verify_shortcode", fake_verify)
    r = eng.redeem_shortcode(tmp_path, "S", _scfg(), now=T0)
    assert r["ok"] is True and r["kind"] == "time" and r["modules"] == ["video"]
    # 累加 1 天:到期 = T0 + 86400
    actual_ts = eng._ts(entstore.read_state(tmp_path, "video")["timeExpireAt"])
    assert abs(actual_ts - (T0 + 86400)) < 2


def test_redeem_shortcode_count_bitmask_and_dedup(monkeypatch, tmp_path):
    # kind=1 次数 + 位图(video|ocr):逐模块 +n;同码再核销 → used,不重复加。
    from chayuan.server.license import engine as eng
    monkeypatch.setattr(eng, "verify_shortcode", lambda *a, **k: {
        "valid": True, "fields": {"kind": 1, "modules": 0b11, "value": 5,
                                  "issueDate": 0, "nonce": 0, "ver": 1}})
    r = eng.redeem_shortcode(tmp_path, "CNT", _scfg(), now=T0)
    assert r["ok"] is True and r["kind"] == "count" and sorted(r["modules"]) == ["ocr", "video"]
    assert entstore.read_state(tmp_path, "video")["counts"] == 5
    assert entstore.read_state(tmp_path, "ocr")["counts"] == 5
    r2 = eng.redeem_shortcode(tmp_path, "CNT", _scfg(), now=T0)
    assert r2["ok"] is False and r2["reason"] == "used"
    assert entstore.read_state(tmp_path, "video")["counts"] == 5  # 不重复加


def test_redeem_shortcode_no_module(monkeypatch, tmp_path):
    # 位图命中的位没有映射模块 → no-module。
    from chayuan.server.license import engine as eng
    monkeypatch.setattr(eng, "verify_shortcode", lambda *a, **k: {
        "valid": True, "fields": {"kind": 0, "modules": 0b100, "value": 1,
                                  "issueDate": 0, "nonce": 0, "ver": 1},
        "expireAt": "2099-01-01T00:00:00.000Z"})
    r = eng.redeem_shortcode(tmp_path, "X", _scfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "no-module"


def test_redeem_shortcode_invalid_rejected(monkeypatch, tmp_path):
    from chayuan.server.license import engine as eng
    monkeypatch.setattr(eng, "verify_shortcode", lambda *a, **k: {"valid": False, "reason": "checksum"})
    r = eng.redeem_shortcode(tmp_path, "BAD", _scfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "checksum"


def test_redeem_nonstring_id_does_not_crash(tmp_path):
    # 签发端给了整数 id → 不应 500,正常核销且去重。
    from tests.server.license._entcode_sign import sign_entcode
    code = sign_entcode({"v": 1, "id": 123456, "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 2}]})
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is True
    assert entstore.read_state(tmp_path, "video")["counts"] == 2
    # 同码再输 → used(去重生效,id 已规整为字符串)
    assert engine.redeem(tmp_path, code, _cfg(), now=T0)["reason"] == "used"


def test_redeem_records_id_before_applying(tmp_path, monkeypatch):
    # 模拟入账中途抛错:id 应已被记录(该码作废),而不是可重复核销。
    code = _code([{"app": "video", "kind": "count", "n": 5}], code_id="boom")

    real_apply = engine._apply_grant
    calls = {"n": 0}

    def flaky(root, grant, now):
        calls["n"] += 1
        raise RuntimeError("disk full")

    monkeypatch.setattr(engine, "_apply_grant", flaky)
    try:
        engine.redeem(tmp_path, code, _cfg(), now=T0)
    except RuntimeError:
        pass
    monkeypatch.setattr(engine, "_apply_grant", real_apply)
    # 该码已被标记消耗 → 再次核销被拒(不会重复刷)
    assert engine.redeem(tmp_path, code, _cfg(), now=T0)["reason"] == "used"

from chayuan.server.license import engine

# 金标:绑定 FP=1122334455667788 的时长序列号(见 test_shortcode.py)
KEY = bytes.fromhex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
TIME_SERIAL = "20407-G4Q00-50485-11B32-AM84"  # ver1 kind0 modules1 value30
CFG = {"hmac_keys": {1: KEY}, "products": {"wps": 0}}  # bit0 = modules1


def test_shortcode_activates_via_candidate(tmp_path, monkeypatch):
    # 本机主指纹与序列号绑定指纹不同,但候选集里包含绑定指纹 → 应激活成功
    monkeypatch.setattr(
        engine, "candidate_fingerprints",
        lambda root: ["deadbeefdeadbeef", "1122334455667788"],
    )
    r = engine.redeem_shortcode(tmp_path, TIME_SERIAL, CFG)
    assert r["ok"] is True   # 候选里有绑定指纹 → 多候选验签通过


def test_shortcode_rejects_when_no_candidate_matches(tmp_path, monkeypatch):
    monkeypatch.setattr(
        engine, "candidate_fingerprints",
        lambda root: ["deadbeefdeadbeef", "8877665544332211"],
    )
    r = engine.redeem_shortcode(tmp_path, TIME_SERIAL, CFG)
    assert r["ok"] is False and r["reason"] == "signature"


def test_shortcode_rejects_when_candidate_list_empty(tmp_path, monkeypatch):
    # 最高安全敏感路径:候选列表为空必须安全拒绝,绝不能误放行
    monkeypatch.setattr(engine, "candidate_fingerprints", lambda root: [])
    r = engine.redeem_shortcode(tmp_path, TIME_SERIAL, CFG)
    assert r["ok"] is False


def test_redeem_passes_when_mid_matches_second_candidate(tmp_path, monkeypatch):
    # mid 绑定码:候选集第二项命中 mid → engine.redeem 应放行
    from tests.server.license._entcode_sign import sign_entcode, public_key_bytes
    MID = "ffffffffffffffff"
    cfg = {"daily_free": {}, "public_key": public_key_bytes(), "hmac_keys": {}}
    code = sign_entcode({"v": 1, "id": "mid-test-001", "src": "promo", "mid": MID,
                         "cardExpireAt": None,
                         "grants": [{"app": "wps", "kind": "count", "n": 1}]})
    monkeypatch.setattr(engine, "candidate_fingerprints",
                        lambda root: ["deadbeefdeadbeef", MID])
    r = engine.redeem(tmp_path, code, cfg)
    assert r["ok"] is True  # mid 命中候选集第二项 → 放行

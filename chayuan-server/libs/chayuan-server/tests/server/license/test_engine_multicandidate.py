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

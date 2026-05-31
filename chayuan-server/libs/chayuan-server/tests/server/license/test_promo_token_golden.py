# 跨语言金标:website token.sign(固定种子)签发 → 桌面 engine.redeem 必须接受并应用 count+until。
from chayuan.server.license import engine, entstore
from tests.server.license._entcode_sign import public_key_bytes

T0 = 1780000000.0
GOLDEN = "eyJjYXJkRXhwaXJlQXQiOm51bGwsImdyYW50cyI6W3siYXBwIjoidmlkZW8iLCJraW5kIjoiY291bnQiLCJuIjozLCJ1bnRpbCI6MTgwMDAwMDAwMH1dLCJpZCI6InBjX2dvbGRlbiIsIm1pZCI6bnVsbCwic3JjIjoicHJvbW8iLCJ2IjoxfQ.XPuMD9O9QZt5z6t2w5utnzGWQjwhfSkG1ChLAQSPVf6wph2d-F3bUTjh6nDgbzDwGCqa2qKPLyxlujUXl6bEDg"


def test_website_signed_promo_token_redeems(tmp_path):
    cfg = {"daily_free": {}, "public_key": public_key_bytes(), "hmac_keys": {}, "products": {"video": 0}}
    r = engine.redeem(tmp_path, GOLDEN, cfg, now=T0)
    assert r["ok"] is True
    st = entstore.read_state(tmp_path, "video")
    assert st["counts"] == 3
    assert abs(engine._ts(st["countExpireAt"]) - 1800000000) < 1     # count until → countExpireAt
    assert engine.redeem(tmp_path, GOLDEN, cfg, now=T0)["reason"] == "used"   # id 去重

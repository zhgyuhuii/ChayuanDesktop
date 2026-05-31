from chayuan.server.license import engine, entstore
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

T0 = 1780000000.0


def _cfg():
    return {"daily_free": {}, "public_key": public_key_bytes(), "hmac_keys": {}, "products": {"video": 0}}


def _promo(card_id):
    return sign_entcode({"v": 1, "id": card_id, "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 3}]})


def test_redeem_promo_records_for_report(tmp_path):
    r = engine.redeem(tmp_path, _promo("pc_abc"), _cfg(), now=T0)
    assert r["ok"] is True
    recs = entstore.read_redeemed_cards(tmp_path)
    assert len(recs) == 1 and recs[0]["id"] == "pc_abc" and "mid" in recs[0] and "at" in recs[0]


def test_redeem_nonpromo_does_not_record(tmp_path):
    code = sign_entcode({"v": 1, "id": "ord1", "src": "purchase", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 1}]})
    engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert entstore.read_redeemed_cards(tmp_path) == []

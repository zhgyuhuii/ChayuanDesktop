from datetime import datetime, timezone
from chayuan.server.license import service, store

KEY = bytes.fromhex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
PUB = bytes.fromhex("3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be")
SERIAL = "2101W-0JWN1-MN2JP-9V4QW-MSGJ"
TOKEN = (
    "eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwi"
    "bWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0"
    ".8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg"
)
# fp 必须等于 1122334455667788 才能过黄金向量 → 测试里固定 mid
CFG = {"hmac_keys": {1: KEY}, "public_key": PUB, "buy_base_url": "https://aidooo.com"}
NOW = datetime(2026, 6, 15, tzinfo=timezone.utc).timestamp()
MID = "1122334455667788"

def test_activate_serial_then_status(tmp_path):
    s = service.activate_serial(tmp_path, "video", SERIAL, CFG, fp=MID, now=NOW)
    assert s["licensed"] is True and s["source"] == "shortcode"
    st = service.current_status(tmp_path, "video", CFG, fp=MID, now=NOW)
    assert st["licensed"] is True

def test_activate_token_file(tmp_path):
    s = service.activate_token(tmp_path, "video", TOKEN, "file", CFG, fp=MID, now=NOW)
    assert s["licensed"] is True and s["source"] == "file"

def test_wrong_machine_token_rejected(tmp_path):
    s = service.activate_token(tmp_path, "video", TOKEN, "file", CFG, fp="8877665544332211", now=NOW)
    assert s["licensed"] is False and s["reason"] == "mismatch"

def test_rollback_detected(tmp_path):
    store.write_activation(tmp_path, {"mid": MID, "app": "video", "expireAt": "2026-07-01T00:00:00.000Z", "seenMax": datetime(2026, 6, 20, tzinfo=timezone.utc).timestamp(), "source": "file", "credential": TOKEN})
    st = service.current_status(tmp_path, "video", CFG, fp=MID, now=datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
    assert st["licensed"] is False and st["reason"] == "rollback"

def test_online_auto_activate(tmp_path):
    import json
    calls = {}
    def http_get(url):
        calls["url"] = url
        return json.dumps({"token": TOKEN})
    st = service.current_status(tmp_path, "video", CFG, fp=MID, now=NOW, http_get=http_get)
    assert st["licensed"] is True and st["source"] == "online"
    assert "mid=" + MID in calls["url"]

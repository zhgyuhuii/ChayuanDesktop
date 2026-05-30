from chayuan.server.license.token import verify_token

PUB = bytes.fromhex("3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be")
TOKEN = (
    "eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwi"
    "bWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0"
    ".8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg"
)

def test_golden_token_verifies():
    r = verify_token(TOKEN, PUB)
    assert r["valid"] is True
    assert r["payload"]["mid"] == "1122334455667788"
    assert r["payload"]["app"] == "video"
    assert r["payload"]["exp"] == 1782864000

def test_wrong_pubkey_fails():
    assert verify_token(TOKEN, bytes(32)) ["valid"] is False

def test_tampered_payload_fails():
    p, sig = TOKEN.split(".")
    import base64, json
    bad = base64.urlsafe_b64encode(json.dumps({"mid": "x"}).encode()).decode().rstrip("=")
    assert verify_token(bad + "." + sig, PUB)["valid"] is False

def test_garbage_returns_invalid_not_raise():
    assert verify_token("garbage", PUB)["valid"] is False
    assert verify_token("", PUB)["valid"] is False

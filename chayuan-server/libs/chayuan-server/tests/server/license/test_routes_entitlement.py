import asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

PUB_HEX = public_key_bytes().hex()
KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", KEY)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", PUB_HEX)
    monkeypatch.setenv("LICENSE_DAILY_FREE", '{"video": 2}')
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)


def test_status_has_new_fields(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    s = c.get("/api/v1/license/status?app=video").json()
    assert s["dailyFree"] == 2 and s["remainingFree"] == 2 and s["counts"] == 0


def test_consume_decrements_free(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/consume", json={"app": "video"}).json()
    assert r["allowed"] is True and r["source"] == "free" and r["remainingFree"] == 1


def test_redeem_applies_counts(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    code = sign_entcode({"v": 1, "id": "x1", "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 7}]})
    r = c.post("/api/v1/license/redeem", json={"code": code}).json()
    assert r["ok"] is True
    assert c.get("/api/v1/license/status?app=video").json()["counts"] == 7


def test_redeem_twice_rejected(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    code = sign_entcode({"v": 1, "id": "dup", "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 7}]})
    assert c.post("/api/v1/license/redeem", json={"code": code}).json()["ok"] is True
    assert c.post("/api/v1/license/redeem", json={"code": code}).json()["reason"] == "used"


def test_invalid_app_consume_rejected(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/consume", json={"app": "../etc"}).json()
    assert r["allowed"] is False and r["reason"] == "invalid-app"


def test_concurrent_consume_no_oversell(tmp_path, monkeypatch):
    # 充 5 次,免费 2 次,并发 20 次 consume → 允许次数恰为 7(2 免费 + 5 次),不超发。
    c = _client(tmp_path, monkeypatch)
    code = sign_entcode({"v": 1, "id": "c5", "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 5}]})
    c.post("/api/v1/license/redeem", json={"code": code})
    import concurrent.futures
    def one():
        return c.post("/api/v1/license/consume", json={"app": "video"}).json()["allowed"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda _: one(), range(20)))
    assert sum(1 for x in results if x) == 7

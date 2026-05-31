import os
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router

KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
PUB = "3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be"

def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", KEY)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", PUB)
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)

def test_fingerprint_and_status_none(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    fp = c.get("/api/v1/license/fingerprint").json()["fingerprint"]
    assert len(fp) == 16
    st = c.get("/api/v1/license/status?app=video").json()
    assert st["licensed"] is False

def test_buy_url(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    u = c.get("/api/v1/license/buy-url?app=video").json()["url"]
    assert u.startswith("https://aidooo.com/buy?app=video&mid=")

def test_activate_serial_route_uses_local_fp(tmp_path, monkeypatch):
    # 用本机指纹签发一个短码 → 需 fp 匹配;这里直接测「非法短码 -> licensed false」
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate", json={"app": "video", "serial": "WRONG-CODE-XXXXX-YYYYY-ZZZZ"})
    assert r.status_code == 200 and r.json()["licensed"] is False

def test_invalid_app_activate_rejected(tmp_path, monkeypatch):
    """Fix 5: path-traversal app string must be rejected with invalid-app reason."""
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate", json={"app": "../../etc", "serial": "x"})
    assert r.status_code == 200
    assert r.json()["licensed"] is False
    assert r.json()["reason"] == "invalid-app"

def test_invalid_app_status_rejected(tmp_path, monkeypatch):
    """Fix 5: status endpoint rejects invalid app names."""
    c = _client(tmp_path, monkeypatch)
    r = c.get("/api/v1/license/status?app=../../etc")
    assert r.status_code == 200
    assert r.json()["licensed"] is False
    assert r.json()["reason"] == "invalid-app"

def test_invalid_app_activate_token_rejected(tmp_path, monkeypatch):
    """Fix 5: activate-token endpoint rejects invalid app names."""
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate-token", json={"app": "<script>", "token": "x"})
    assert r.status_code == 200
    assert r.json()["licensed"] is False
    assert r.json()["reason"] == "invalid-app"

def test_invalid_app_buy_url_rejected(tmp_path, monkeypatch):
    """Fix 5: buy-url returns empty url for invalid app names."""
    c = _client(tmp_path, monkeypatch)
    r = c.get("/api/v1/license/buy-url?app=../../etc")
    assert r.status_code == 200
    assert r.json()["url"] == ""


def test_entitlements_offline_fallback_to_local(tmp_path, monkeypatch):
    # 无网络 → 在线拉取失败 → 回落本地激活记录。
    from chayuan.server.license import store
    c = _client(tmp_path, monkeypatch)
    # buy_base_url 指向不可达地址,确保在线分支失败走本地回落
    monkeypatch.setenv("LICENSE_BUY_BASE_URL", "http://127.0.0.1:9")
    store.write_activation(tmp_path, {
        "mid": "1122334455667788", "app": "video",
        "expireAt": "2099-01-01T00:00:00.000Z", "seenMax": 0,
        "source": "shortcode", "credential": "AAAAA-BBBBB-CCCCC-DDDDD-EEEE",
    })
    r = c.get("/api/v1/license/entitlements").json()
    assert "fingerprint" in r
    assert r["online"] is False
    items = r["items"]
    assert len(items) == 1
    assert items[0]["app"] == "video"
    assert items[0]["active"] is True
    assert items[0]["serial"] == "AAAAA-BBBBB-CCCCC-DDDDD-EEEE"

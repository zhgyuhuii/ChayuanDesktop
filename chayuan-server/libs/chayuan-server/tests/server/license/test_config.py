from chayuan.server.license.config import load_license_config

def test_load_from_env(monkeypatch):
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", "00" * 32)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", "11" * 32)
    monkeypatch.setenv("LICENSE_BUY_BASE_URL", "https://aidooo.com")
    cfg = load_license_config()
    assert cfg["hmac_keys"][1] == bytes.fromhex("00" * 32)
    assert cfg["public_key"] == bytes.fromhex("11" * 32)
    assert cfg["buy_base_url"] == "https://aidooo.com"
    assert cfg["products"]["video"] == 1

def test_missing_keys_marks_unconfigured(monkeypatch):
    monkeypatch.delenv("LICENSE_HMAC_KEY_V1", raising=False)
    monkeypatch.delenv("LICENSE_ED25519_PUBLIC_KEY", raising=False)
    cfg = load_license_config()
    assert cfg["configured"] is False

def test_bad_hex_hmac_key_does_not_raise(monkeypatch):
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", "zzzz")
    monkeypatch.delenv("LICENSE_ED25519_PUBLIC_KEY", raising=False)
    cfg = load_license_config()
    assert cfg["configured"] is False

def test_bad_hex_public_key_does_not_raise(monkeypatch):
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", "00" * 32)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", "zzzz")
    cfg = load_license_config()
    assert cfg["configured"] is False

def test_bad_hex_both_does_not_raise(monkeypatch):
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", "zzzz")
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", "zzzz")
    cfg = load_license_config()
    assert cfg["configured"] is False

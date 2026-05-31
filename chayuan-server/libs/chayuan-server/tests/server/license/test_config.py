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


def test_load_from_yaml_file_when_env_absent(monkeypatch, tmp_path):
    # 无 env 时,从 $CHAYUAN_ROOT/license_settings.yaml 读取。
    for k in ("LICENSE_HMAC_KEY_V1", "LICENSE_ED25519_PUBLIC_KEY", "LICENSE_BUY_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    (tmp_path / "license_settings.yaml").write_text(
        "hmac_key_v1: '%s'\n"
        "ed25519_public_key: '%s'\n"
        "buy_base_url: 'https://relay.example.com'\n"
        "products: { video: 1, premium: 2 }\n" % ("00" * 32, "11" * 32),
        encoding="utf-8",
    )
    cfg = load_license_config()
    assert cfg["configured"] is True
    assert cfg["hmac_keys"][1] == bytes.fromhex("00" * 32)
    assert cfg["public_key"] == bytes.fromhex("11" * 32)
    assert cfg["buy_base_url"] == "https://relay.example.com"
    assert cfg["products"]["premium"] == 2


def test_env_overrides_yaml_file(monkeypatch, tmp_path):
    # env 与文件同时存在时,env 赢。
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    (tmp_path / "license_settings.yaml").write_text(
        "buy_base_url: 'https://from-file.example.com'\n", encoding="utf-8"
    )
    monkeypatch.setenv("LICENSE_BUY_BASE_URL", "https://from-env.example.com")
    cfg = load_license_config()
    assert cfg["buy_base_url"] == "https://from-env.example.com"


import json as _json


def test_daily_free_from_env(monkeypatch):
    monkeypatch.setenv("LICENSE_DAILY_FREE", _json.dumps({"video": 2, "chat": 10}))
    cfg = load_license_config()
    assert cfg["daily_free"]["video"] == 2
    assert cfg["daily_free"]["chat"] == 10


def test_daily_free_default_empty(monkeypatch):
    monkeypatch.delenv("LICENSE_DAILY_FREE", raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", "/nonexistent-xyz")
    cfg = load_license_config()
    assert cfg["daily_free"] == {}


def test_daily_free_bad_json_falls_back(monkeypatch):
    monkeypatch.setenv("LICENSE_DAILY_FREE", "{not json")
    cfg = load_license_config()
    assert cfg["daily_free"] == {}


def test_free_modules_from_env(monkeypatch):
    monkeypatch.setenv("LICENSE_FREE_MODULES", _json.dumps(["kb", "chat"]))
    cfg = load_license_config()
    assert set(cfg["free_modules"]) == {"kb", "chat"}


def test_free_modules_default_empty(monkeypatch):
    monkeypatch.delenv("LICENSE_FREE_MODULES", raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", "/nonexistent-xyz")
    cfg = load_license_config()
    assert cfg["free_modules"] == []

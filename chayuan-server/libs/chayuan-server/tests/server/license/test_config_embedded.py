import importlib


def test_falls_back_to_embedded(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    for k in ("LICENSE_HMAC_KEY_V1", "LICENSE_ED25519_PUBLIC_KEY", "LICENSE_PRODUCTS", "LICENSE_ACTIVE_KEY_ID"):
        monkeypatch.delenv(k, raising=False)
    cfg = importlib.import_module("chayuan.server.license.config").load_license_config()
    from chayuan.server.license.embedded import EMBEDDED
    assert cfg["active_key_id"] == EMBEDDED["active_key_id"]
    assert cfg["hmac_keys"][EMBEDDED["active_key_id"]] == bytes.fromhex(EMBEDDED["hmac_key_v1"])
    assert cfg["public_key"] == bytes.fromhex(EMBEDDED["ed25519_public_key"])
    assert cfg["products"] == EMBEDDED["products"]
    assert cfg["buy_base_url"] == EMBEDDED["buy_base_url"]


def test_env_cannot_override_products(tmp_path, monkeypatch):
    # products 是全局契约,只认内嵌:即便设了 env,也必须返回完整内嵌位图。
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.setenv("LICENSE_PRODUCTS", '{"video": 0}')
    cfg = importlib.import_module("chayuan.server.license.config").load_license_config()
    from chayuan.server.license.embedded import EMBEDDED
    assert cfg["products"] == EMBEDDED["products"]
    assert cfg["products"]["avatar"] == 3

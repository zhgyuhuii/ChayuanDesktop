"""授权验证配置:从 env 读(桌面打包注入)。HMAC 与 website 同一把;Ed25519 仅公钥。"""
import os
import json


def load_license_config() -> dict:
    active = int(os.environ.get("LICENSE_ACTIVE_KEY_ID", "1"))
    hmac_hex = os.environ.get("LICENSE_HMAC_KEY_V1", "")
    pub_hex = os.environ.get("LICENSE_ED25519_PUBLIC_KEY", "")
    try:
        products = json.loads(os.environ.get("LICENSE_PRODUCTS", "")) if os.environ.get("LICENSE_PRODUCTS") else {"video": 1}
    except Exception:
        products = {"video": 1}
    hmac_keys = {}
    if hmac_hex:
        hmac_keys[active] = bytes.fromhex(hmac_hex)
    public_key = bytes.fromhex(pub_hex) if pub_hex else b""
    return {
        "active_key_id": active,
        "hmac_keys": hmac_keys,
        "public_key": public_key,
        "buy_base_url": os.environ.get("LICENSE_BUY_BASE_URL", "https://aidooo.com"),
        "products": products,
        "configured": bool(hmac_keys and public_key),
    }

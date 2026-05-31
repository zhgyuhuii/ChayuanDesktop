"""授权验证配置。

两个来源,**env 优先、文件兜底**:
1. 环境变量(桌面打包时注入,见下方 key 名)。
2. ``$CHAYUAN_ROOT/license_settings.yaml``(手动部署/单机时可直接编辑;与项目里
   ``basic_settings.yaml`` 等同款位置)。

HMAC 与 website 同一把(B1 短码验签);Ed25519 仅公钥(令牌验签)。

license_settings.yaml 字段:
    hmac_key_v1: "<64 hex>"          # 与 website 同一把
    ed25519_public_key: "<64 hex>"   # website 一键生成里的「桌面内嵌公钥」
    buy_base_url: "https://aidooo.com"
    active_key_id: 1
    products: { video: 1 }
"""
import os
import json
from pathlib import Path


def _root() -> Path:
    env = os.environ.get("CHAYUAN_ROOT")
    if env:
        return Path(env)
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT)


def settings_file() -> Path:
    """用户可编辑的授权配置文件绝对路径。"""
    return _root() / "license_settings.yaml"


def _load_file() -> dict:
    p = settings_file()
    if not p.is_file():
        return {}
    try:
        import yaml
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def load_license_config() -> dict:
    f = _load_file()

    def pick(env_key: str, file_key: str, default: str = "") -> str:
        v = os.environ.get(env_key)
        if v:
            return v
        fv = f.get(file_key)
        return str(fv) if fv is not None else default

    try:
        active = int(pick("LICENSE_ACTIVE_KEY_ID", "active_key_id", "1"))
    except ValueError:
        active = 1

    hmac_hex = pick("LICENSE_HMAC_KEY_V1", "hmac_key_v1")
    pub_hex = pick("LICENSE_ED25519_PUBLIC_KEY", "ed25519_public_key")
    buy_base_url = pick("LICENSE_BUY_BASE_URL", "buy_base_url", "https://aidooo.com")

    # products:env JSON 优先,其次文件里的 dict,最后默认 {"video": 1}
    products = {"video": 1}
    env_products = os.environ.get("LICENSE_PRODUCTS")
    if env_products:
        try:
            products = json.loads(env_products)
        except Exception:
            products = {"video": 1}
    elif isinstance(f.get("products"), dict):
        products = f["products"]

    hmac_keys = {}
    if hmac_hex:
        try:
            hmac_keys[active] = bytes.fromhex(hmac_hex)
        except ValueError:
            hmac_keys = {}
    public_key = b""
    if pub_hex:
        try:
            public_key = bytes.fromhex(pub_hex)
        except ValueError:
            public_key = b""
    return {
        "active_key_id": active,
        "hmac_keys": hmac_keys,
        "public_key": public_key,
        "buy_base_url": buy_base_url,
        "products": products,
        "configured": bool(hmac_keys and public_key),
    }

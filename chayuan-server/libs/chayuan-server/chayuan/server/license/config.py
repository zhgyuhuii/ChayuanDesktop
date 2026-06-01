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


# 默认每日免费额度(模块 id 与网站商品 id 一致:对话/视频/知识库/数字人/图转文/音转文)。
# env LICENSE_DAILY_FREE / 文件 daily_free 可覆盖。
DEFAULT_DAILY_FREE = {
    "chat": 60,     # 对话
    "video": 5,     # 视频生成
    "avatar": 5,    # 数字人
    "note": 30,     # AI笔记
    "kb": 30,       # 知识库
    "ocr": 50,      # 图转文
    "asr": 30,      # 音转文
}


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

    # products:模块->位号(0-7)。env JSON 优先,其次文件 dict,最后默认 {"video": 0}
    products = {"video": 0}
    env_products = os.environ.get("LICENSE_PRODUCTS")
    if env_products:
        try:
            products = json.loads(env_products)
        except Exception:
            products = {"video": 0}
    elif isinstance(f.get("products"), dict):
        products = f["products"]
    try:
        products = {str(k): int(v) for k, v in products.items()}
    except (TypeError, ValueError):
        products = {"video": 0}

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

    # 每日免费配额:env(JSON)优先,其次文件 daily_free,最后默认 DEFAULT_DAILY_FREE。
    daily_free = dict(DEFAULT_DAILY_FREE)
    env_df = os.environ.get("LICENSE_DAILY_FREE")
    if env_df:
        try:
            v = json.loads(env_df)
            daily_free = {str(k): int(x) for k, x in v.items()} if isinstance(v, dict) else {}
        except Exception:
            daily_free = {}
    elif isinstance(f.get("daily_free"), dict):
        daily_free = {str(k): int(x) for k, x in f["daily_free"].items()}

    # 免费模块:整模块不门控(定价="免费")。env(JSON 数组)优先,其次文件 free_modules。
    free_modules = []
    env_fm = os.environ.get("LICENSE_FREE_MODULES")
    if env_fm:
        try:
            v = json.loads(env_fm)
            free_modules = [str(x) for x in v] if isinstance(v, list) else []
        except Exception:
            free_modules = []
    elif isinstance(f.get("free_modules"), list):
        free_modules = [str(x) for x in f["free_modules"]]

    tel = pick("LICENSE_TELEMETRY", "telemetry_enabled", "true").strip().lower()
    telemetry_enabled = tel not in ("0", "false", "no", "off")

    return {
        "active_key_id": active,
        "telemetry_enabled": telemetry_enabled,
        "hmac_keys": hmac_keys,
        "public_key": public_key,
        "buy_base_url": buy_base_url,
        "products": products,
        "configured": bool(hmac_keys and public_key),
        "daily_free": daily_free,
        "free_modules": free_modules,
    }

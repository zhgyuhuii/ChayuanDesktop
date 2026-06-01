"""密钥同源核对(桌面侧)。
把 website 的 `node scripts/license-keycheck.mjs` 输出的 `CHALLENGE={...}` 那行整段,
作为参数或 CHALLENGE 环境变量传进来,用本机内嵌的授权密钥去验:
  验过 = 密钥与网站同源(序列号能验);验不过 = 不一致(就是"序列号无法验证"的根因)。

用法(在桌面端,CHAYUAN_ROOT 指向安装目录或已注入 LICENSE_* env):
  python scripts/license_keycheck.py 'CHALLENGE={...整段...}'
或:
  CHALLENGE='{...}' python scripts/license_keycheck.py
"""
import os
import sys
import json

from chayuan.server.license.config import load_license_config
from chayuan.server.license.shortcode import verify_shortcode
from chayuan.server.license.token import verify_token


def _read_challenge() -> dict:
    raw = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CHALLENGE", "")
    raw = raw.strip()
    if raw.startswith("CHALLENGE="):
        raw = raw[len("CHALLENGE="):]
    if not raw:
        print("❌ 没收到 CHALLENGE。把 website 脚本输出的 CHALLENGE=... 整行传进来。")
        sys.exit(2)
    return json.loads(raw)


def main():
    ch = _read_challenge()
    cfg = load_license_config()

    print("=== 桌面侧密钥指纹 ===")
    print("configured    :", cfg.get("configured"))
    print("active_key_id :", cfg.get("active_key_id"))
    print("products      :", json.dumps(cfg.get("products", {}), ensure_ascii=False))
    prod_hash = __import__("hashlib").sha256(
        json.dumps(cfg.get("products", {}), sort_keys=True).encode()).hexdigest()[:8]
    print("products_hash :", prod_hash)
    print()

    ok = True
    # 1) HMAC 短码验签(核心:序列号能不能验就看这个)
    r = verify_shortcode(ch["testSerial"], bytes.fromhex(ch["testFp"]), cfg.get("hmac_keys", {}))
    if r.get("valid"):
        print("✅ HMAC 短码: 验过 —— hmac 密钥与网站同源")
    else:
        ok = False
        print(f"❌ HMAC 短码: 验不过 (reason={r.get('reason')}) —— "
              + ("桌面没内嵌 hmac 密钥" if r.get("reason") == "unknown-key" else "桌面 hmac 密钥与网站不一致"))

    # 2) Ed25519 令牌验签(促销卡/令牌走这个)
    pub = cfg.get("public_key", b"")
    rt = verify_token(ch["testToken"], pub)
    if rt.get("valid"):
        print("✅ Ed25519 令牌: 验过 —— ed25519 公钥与网站同源")
    else:
        ok = False
        print("❌ Ed25519 令牌: 验不过 —— 桌面 ed25519 公钥与网站不一致(或未内嵌)")

    # 3) 对照 active_key_id / products
    if cfg.get("active_key_id") != ch.get("activeKeyId"):
        ok = False
        print(f"❌ active_key_id 不一致: 桌面={cfg.get('active_key_id')} 网站={ch.get('activeKeyId')}")
    if prod_hash != ch.get("productsHash"):
        print(f"⚠️ products_hash 不一致: 桌面={prod_hash} 网站={ch.get('productsHash')} "
              "(模块→位号映射不同,会导致核销到错模块;次于密钥,但也要对齐)")

    print()
    if ok:
        print("结论: ✅ 密钥同源,网站签的序列号本机能验。若仍报无法验证,检查机器指纹/codec 构建版本。")
    else:
        print("结论: ❌ 不同源。修法: 网站「一键生成授权密钥」→ 把 hmac_key_v1 + ed25519 公钥 + products "
              "写进桌面 license_settings.yaml(或重新打包内嵌)→ 重启桌面。")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

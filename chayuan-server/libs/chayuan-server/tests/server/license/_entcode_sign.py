"""测试用统一权益码签发器(固定测试 Ed25519 私钥)。
canonical = json.dumps(payload, sort_keys=True, separators=(",",":"))。
website 签发端(Plan B)必须产出字节一致的码。"""
import json
import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

# 固定测试私钥种子(32 字节 = 00 01 02 ... 1f),仅测试用。
SEED_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def public_key_bytes() -> bytes:
    sk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(SEED_HEX))
    return sk.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def sign_entcode(payload: dict) -> str:
    sk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(SEED_HEX))
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sig = sk.sign(msg)
    return _b64u(msg) + "." + _b64u(sig)

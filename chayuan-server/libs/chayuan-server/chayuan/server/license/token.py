"""Ed25519 强签名令牌验签。与 website server/license/token.js 兼容(仅需公钥)。"""
import json
import base64

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature


def _b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_token(token: str, public_key: bytes) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return {"valid": False}
        msg = _b64url(parts[0])
        sig = _b64url(parts[1])
        Ed25519PublicKey.from_public_bytes(public_key).verify(sig, msg)
        return {"valid": True, "payload": json.loads(msg.decode("utf-8"))}
    except (InvalidSignature, ValueError, Exception):
        return {"valid": False}

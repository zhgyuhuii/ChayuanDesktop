"""统一权益码:base64url(canonicalJSON).base64url(ed25519sig)。复用 token.verify_token(仅公钥)。"""
from .token import verify_token

_VALID_APP = set("abcdefghijklmnopqrstuvwxyz0123456789_-")


def verify(code: str, public_key: bytes) -> dict:
    """验签;成功返回 {valid:True, payload}。"""
    return verify_token(code, public_key)


def validate_payload(p: dict) -> str | None:
    """形状校验;合法返回 None,否则返回原因字符串。"""
    if not isinstance(p, dict):
        return "shape"
    grants = p.get("grants")
    if not isinstance(grants, list) or not grants:
        return "shape"
    for g in grants:
        if not isinstance(g, dict):
            return "shape"
        app = g.get("app")
        if not isinstance(app, str) or not app or any(c not in _VALID_APP for c in app):
            return "grant-app"
        kind = g.get("kind")
        if kind == "time":
            if not (isinstance(g.get("days"), int) or isinstance(g.get("until"), (int, float))):
                return "grant-value"
        elif kind == "count":
            if not isinstance(g.get("n"), int) or g["n"] <= 0:
                return "grant-value"
        else:
            return "grant-kind"
    return None

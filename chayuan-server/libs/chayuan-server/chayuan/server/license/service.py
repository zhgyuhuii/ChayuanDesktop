"""授权编排:本地态(防回拨+过期)+ 短码/令牌激活 + 偶尔在线自动激活。"""
from datetime import datetime, timezone

from .shortcode import verify_shortcode
from .token import verify_token
from .codec import to_iso
from . import store
from .fingerprint import fingerprint as _fp

ROLLBACK_TOLERANCE = 86400  # 1 天(秒)


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def _fp_of(root, fp):
    return fp if fp is not None else _fp(root)


def current_status(root, app, cfg, *, fp=None, now=None, http_get=None) -> dict:
    now = now if now is not None else _now()
    rec = store.read_activation(root, app)
    if not rec:
        if http_get:
            s = activate_online(root, app, cfg, fp=fp, now=now, http_get=http_get)
            if s["licensed"]:
                return s
        return {"licensed": False, "app": app, "reason": "none"}
    if now < rec["seenMax"] - ROLLBACK_TOLERANCE:
        return {"licensed": False, "app": app, "reason": "rollback", "expireAt": rec["expireAt"], "source": rec.get("source")}
    if now > _ts(rec["expireAt"]):
        if http_get:
            s = activate_online(root, app, cfg, fp=fp, now=now, http_get=http_get)
            if s["licensed"]:
                return s
        return {"licensed": False, "app": app, "reason": "expired", "expireAt": rec["expireAt"], "source": rec.get("source")}
    if now > rec["seenMax"]:
        rec["seenMax"] = now
        store.write_activation(root, rec)
    return {"licensed": True, "app": app, "expireAt": rec["expireAt"], "source": rec.get("source")}


def activate_serial(root, app, serial, cfg, *, fp=None, now=None) -> dict:
    now = now if now is not None else _now()
    fph = _fp_of(root, fp)
    r = verify_shortcode(serial, bytes.fromhex(fph), cfg["hmac_keys"])
    if not r["valid"]:
        return {"licensed": False, "app": app, "reason": r["reason"]}
    if _ts(r["expireAt"]) <= now:
        return {"licensed": False, "app": app, "reason": "expired"}
    rec = {"mid": fph, "app": app, "expireAt": r["expireAt"], "seenMax": now, "source": "shortcode", "credential": serial}
    store.write_activation(root, rec)
    return {"licensed": True, "app": app, "expireAt": r["expireAt"], "source": "shortcode"}


def activate_token(root, app, token, source, cfg, *, fp=None, now=None) -> dict:
    now = now if now is not None else _now()
    fph = _fp_of(root, fp)
    r = verify_token(token, cfg["public_key"])
    if not r["valid"]:
        return {"licensed": False, "app": app, "reason": "none"}
    p = r["payload"]
    if p.get("app") != app or str(p.get("mid", "")).lower() != fph.lower():
        return {"licensed": False, "app": app, "reason": "mismatch"}
    exp = p.get("exp", 0)
    if not exp or exp <= now:
        return {"licensed": False, "app": app, "reason": "expired"}
    expire = to_iso(datetime.fromtimestamp(exp, tz=timezone.utc))
    rec = {"mid": fph, "app": app, "expireAt": expire, "seenMax": now, "source": source, "credential": token}
    store.write_activation(root, rec)
    return {"licensed": True, "app": app, "expireAt": expire, "source": source}


def activate_online(root, app, cfg, *, fp=None, now=None, http_get=None) -> dict:
    import json
    import urllib.request
    fph = _fp_of(root, fp)
    base = cfg.get("buy_base_url", "https://aidooo.com")
    url = f"{base}/api/license/entitlement?mid={fph}&app={app}"
    getter = http_get or (lambda u: urllib.request.urlopen(u, timeout=8).read().decode("utf-8"))
    try:
        token = json.loads(getter(url)).get("token")
    except Exception:
        return {"licensed": False, "app": app, "reason": "none"}
    if not token:
        return {"licensed": False, "app": app, "reason": "none"}
    return activate_token(root, app, token, "online", cfg, fp=fph, now=now)

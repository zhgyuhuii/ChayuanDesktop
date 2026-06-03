"""授权验证 HTTP 路由(挂 /api/v1/license)。单机匿名透明放行,前端(桌面/网页同一套)调用。"""
from __future__ import annotations

import re
import threading
from pathlib import Path

from fastapi import APIRouter, Body, Query

from chayuan.server.license import service
from chayuan.server.license import engine
from chayuan.server.license.config import load_license_config
from chayuan.server.license.fingerprint import fingerprint as _fp

license_router = APIRouter(prefix="/api/v1/license", tags=["license"])

_mutate_lock = threading.Lock()


def _valid_app(app: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9_-]{1,32}", app or ""))


def _root() -> Path:
    import os
    env = os.environ.get("CHAYUAN_ROOT")
    if env:
        return Path(env)
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT)


@license_router.get("/fingerprint")
def get_fingerprint():
    return {"fingerprint": _fp(_root())}


@license_router.get("/buy-url")
def get_buy_url(app: str = Query("video")):
    if not _valid_app(app):
        return {"url": "", "channels": {"wechat": False, "alipay": False}}
    cfg = load_license_config()
    fp = _fp(_root())
    # 顺带拉买站「支持的支付渠道」,供激活弹框显示对应官方 logo + 文案(联网才有,断网默认空)。
    channels = {"wechat": False, "alipay": False}
    try:
        import json as _json
        data = _json.loads(_safe_get(f"{cfg['buy_base_url']}/api/pay/channels"))
        if isinstance(data, dict):
            channels = {"wechat": bool(data.get("wechat")), "alipay": bool(data.get("alipay"))}
    except Exception:
        pass
    return {"url": f"{cfg['buy_base_url']}/buy?app={app}&mid={fp}", "channels": channels}


@license_router.get("/promo-url")
def get_promo_url():
    cfg = load_license_config()
    fp = _fp(_root())
    return {"url": f"{cfg['buy_base_url']}/promo?mid={fp}", "fingerprint": fp}


@license_router.get("/share-url")
def get_share_url(app: str = Query("video")):
    # 本地拼接的裂变分享链接(离线可用):buy_base_url 打包内置 + 本机指纹当 ref。
    # 复用 promo-url 模式,不发任何外网请求。ref=分享者 mid,买家页带 ?ref= 归因。
    if not _valid_app(app):
        return {"url": "", "fingerprint": ""}
    cfg = load_license_config()
    fp = _fp(_root())
    return {"url": f"{cfg['buy_base_url']}/buy?app={app}&ref={fp}", "fingerprint": fp}


@license_router.get("/status")
def get_status(app: str = Query("video")):
    if not _valid_app(app):
        return {"licensed": False, "reason": "invalid-app"}
    cfg = load_license_config()
    return engine.status(_root(), app, cfg)


@license_router.post("/activate")
def post_activate(payload: dict = Body(...)):
    cfg = load_license_config()
    with _mutate_lock:
        r = engine.redeem_shortcode(_root(), payload.get("serial", ""), cfg)
    # 前端/门控统一按 licensed 判定;redeem_shortcode 返回 ok,这里映射过去。
    r.setdefault("licensed", bool(r.get("ok")))
    r.setdefault("fingerprint", _fp(_root()))
    return r


@license_router.get("/diag")
def get_diag():
    """同源诊断:对比网站后台「一键生成密钥」里的 products_hash,判断密钥/位号是否同源。"""
    import hashlib as _h
    import json as _json
    cfg = load_license_config()
    prod = cfg.get("products", {})
    prod_hash = _h.sha256(_json.dumps(prod, sort_keys=True).encode()).hexdigest()[:8]
    return {
        "configured": cfg.get("configured", False),
        "active_key_id": cfg.get("active_key_id"),
        "products": prod,
        "products_hash": prod_hash,
        "fingerprint": _fp(_root()),
    }


@license_router.post("/activate-token")
def post_activate_token(payload: dict = Body(...)):
    cfg = load_license_config()
    with _mutate_lock:
        r = engine.redeem(_root(), payload.get("token", ""), cfg)
    r.setdefault("licensed", bool(r.get("ok")))
    return r


@license_router.post("/consume")
def post_consume(payload: dict = Body(...)):
    app = payload.get("app", "video")
    if not _valid_app(app):
        return {"allowed": False, "source": "none", "reason": "invalid-app"}
    cfg = load_license_config()
    with _mutate_lock:
        return engine.consume(_root(), app, cfg)


@license_router.post("/redeem")
def post_redeem(payload: dict = Body(...)):
    code = payload.get("code", "")
    if not isinstance(code, str) or not code:
        return {"ok": False, "reason": "empty"}
    cfg = load_license_config()
    with _mutate_lock:
        return engine.redeem(_root(), code, cfg)


@license_router.get("/entitlements")
def get_entitlements():
    """「我的权限」:在线拉该机器购买记录(产品/到期/购买时间/金额/序列号);
    断网则回落本地激活记录(只有到期/序列号,无金额/购买时间)。"""
    import json as _json
    from chayuan.server.license import store
    from chayuan.server.license import service
    cfg = load_license_config()
    root = _root()
    fp = _fp(root)
    now = service._now()

    def _active(exp):
        if not exp:
            return False
        try:
            return service._ts(exp) > now
        except Exception:
            return False

    rows, online = [], False
    try:
        data = _json.loads(_safe_get(f"{cfg['buy_base_url']}/api/license/my?mid={fp}"))
        rows = data.get("items", []) if isinstance(data, dict) else []
        online = True
    except Exception:
        rows = []

    items = []
    if rows:
        for o in rows:
            items.append({
                "app": o.get("app"),
                "productName": o.get("productName") or o.get("app"),
                "amountFen": o.get("amountFen"),
                "paidAt": o.get("paidAt"),
                "expireAt": o.get("expireAt"),
                "serial": o.get("serial"),
                "active": _active(o.get("expireAt")),
                "source": "online",
            })
    else:
        for app in (cfg.get("products") or {"video": 1}).keys():
            rec = store.read_activation(root, app)
            if rec:
                items.append({
                    "app": app, "productName": app,
                    "amountFen": None, "paidAt": None,
                    "expireAt": rec.get("expireAt"), "serial": rec.get("credential"),
                    "active": _active(rec.get("expireAt")), "source": rec.get("source"),
                })
    return {"fingerprint": fp, "online": online, "items": items}


@license_router.post("/reset")
def post_reset(payload: dict = Body(default={})):
    """重置本机激活(删除本地授权记录)。注意:若线上仍有该机器授权且联网,
    下次 status 会在线自动重新激活;彻底重置需同时在网站后台吊销该 mid 的授权。"""
    from chayuan.server.license import store
    app = (payload or {}).get("app", "video")
    if not _valid_app(app):
        return {"ok": False, "reason": "invalid-app"}
    removed = store.delete_activation(_root(), app)
    return {"ok": True, "removed": removed, "app": app}


def _safe_get(url: str) -> str:
    import urllib.request
    return urllib.request.urlopen(url, timeout=8).read().decode("utf-8")

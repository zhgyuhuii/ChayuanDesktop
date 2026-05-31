"""授权验证 HTTP 路由(挂 /api/v1/license)。单机匿名透明放行,前端(桌面/网页同一套)调用。"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Body, Query

from chayuan.server.license import service
from chayuan.server.license.config import load_license_config
from chayuan.server.license.fingerprint import fingerprint as _fp

license_router = APIRouter(prefix="/api/v1/license", tags=["license"])


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
        return {"url": ""}
    cfg = load_license_config()
    fp = _fp(_root())
    return {"url": f"{cfg['buy_base_url']}/buy?app={app}&mid={fp}"}


@license_router.get("/status")
def get_status(app: str = Query("video")):
    if not _valid_app(app):
        return {"licensed": False, "reason": "invalid-app"}
    cfg = load_license_config()
    # 偶尔在线:status 时尝试在线自动激活(联网才会成功,断网静默)
    http_get_fn = None if not cfg["configured"] else _safe_get
    return service.current_status(_root(), app, cfg, http_get=http_get_fn)


@license_router.post("/activate")
def post_activate(payload: dict = Body(...)):
    app = payload.get("app", "video")
    if not _valid_app(app):
        return {"licensed": False, "reason": "invalid-app"}
    cfg = load_license_config()
    return service.activate_serial(_root(), app, payload.get("serial", ""), cfg)


@license_router.post("/activate-token")
def post_activate_token(payload: dict = Body(...)):
    app = payload.get("app", "video")
    if not _valid_app(app):
        return {"licensed": False, "reason": "invalid-app"}
    cfg = load_license_config()
    return service.activate_token(_root(), app, payload.get("token", ""), "file", cfg)


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

"""授权验证 HTTP 路由(挂 /api/v1/license)。单机匿名透明放行,前端(桌面/网页同一套)调用。"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, Query

from chayuan.server.license import service
from chayuan.server.license.config import load_license_config
from chayuan.server.license.fingerprint import fingerprint as _fp

license_router = APIRouter(prefix="/api/v1/license", tags=["license"])


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
    cfg = load_license_config()
    fp = _fp(_root())
    return {"url": f"{cfg['buy_base_url']}/buy?app={app}&mid={fp}"}


@license_router.get("/status")
def get_status(app: str = Query("video")):
    cfg = load_license_config()
    # 偶尔在线:status 时尝试在线自动激活(联网才会成功,断网静默)
    http_get_fn = None if not cfg["configured"] else _safe_get
    return service.current_status(_root(), app, cfg, http_get=http_get_fn)


@license_router.post("/activate")
def post_activate(payload: dict = Body(...)):
    cfg = load_license_config()
    return service.activate_serial(_root(), payload.get("app", "video"), payload.get("serial", ""), cfg)


@license_router.post("/activate-token")
def post_activate_token(payload: dict = Body(...)):
    cfg = load_license_config()
    return service.activate_token(_root(), payload.get("app", "video"), payload.get("token", ""), "file", cfg)


def _safe_get(url: str) -> str:
    import urllib.request
    return urllib.request.urlopen(url, timeout=8).read().decode("utf-8")

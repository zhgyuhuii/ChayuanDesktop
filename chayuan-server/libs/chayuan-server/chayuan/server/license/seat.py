"""网络版部署席位授权。与单机版完全隔离：is_single_machine() 时全部短路。

载体 = website 签发的 Ed25519 令牌（payload {kind:'seat', maxUsers, fp, exp, ...}），
落盘 $CHAYUAN_ROOT/deployment_license.json。与 per-module 短码 license 互不干涉。
"""
from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Optional

from chayuan.server.profiles import is_single_machine

DEFAULT_WEB_MAX_USERS = 10
_DEPLOYMENT_ID_FILE = "deployment_id.json"
_DEPLOYMENT_LICENSE_FILE = "deployment_license.json"


class SeatLimitReached(Exception):
    def __init__(self, used: int, limit: int):
        self.used = used
        self.limit = limit
        super().__init__(f"席位已满（{used}/{limit}），请升级网络版席位或停用旧账号。")


def _seat_disabled() -> bool:
    return os.environ.get("CHAYUAN_SEAT_DISABLED", "").strip().lower() in ("1", "true", "yes")


def deployment_fingerprint(root: Path) -> str:
    """稳定的部署指纹；首次生成并持久化到 deployment_id.json。"""
    p = root / _DEPLOYMENT_ID_FILE
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        fp = str(data.get("fp") or "")
        if fp:
            return fp
    except Exception:
        pass
    fp = secrets.token_hex(16)
    try:
        root.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"fp": fp}), encoding="utf-8")
    except Exception:
        pass
    return fp


def read_deployment_license(root: Path) -> Optional[dict]:
    try:
        data = json.loads((root / _DEPLOYMENT_LICENSE_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_deployment_license(root: Path, data: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / _DEPLOYMENT_LICENSE_FILE).write_text(json.dumps(data), encoding="utf-8")


def _expired(lic: dict, now: Optional[float] = None) -> bool:
    exp = lic.get("expireAt")
    if not exp:
        return True
    now = time.time() if now is None else now
    return float(exp) <= now


def effective_max_users(root: Path, now: Optional[float] = None) -> Optional[int]:
    """None = 无限制。单机短路 + kill-switch 兜底；网络版无 license 回退默认 10。"""
    if _seat_disabled():
        return None
    if is_single_machine():
        return None
    lic = read_deployment_license(root)
    if lic and not _expired(lic, now):
        try:
            return int(lic["maxUsers"])
        except (KeyError, ValueError, TypeError):
            return DEFAULT_WEB_MAX_USERS
    return DEFAULT_WEB_MAX_USERS


def assert_seat_available(root: Optional[Path] = None) -> None:
    """create_user 写库前调用。网络版达上限抛 SeatLimitReached；单机/未约束 no-op。"""
    if root is None:
        env = os.environ.get("CHAYUAN_ROOT")
        root = Path(env) if env else Path.cwd()
    limit = effective_max_users(root)
    if limit is None:
        return
    from sqlalchemy import func, select
    from chayuan.server.db.models.user_model import UserModel
    from chayuan.server.db.session import session_scope
    with session_scope() as s:
        used = int(s.execute(select(func.count()).select_from(UserModel)).scalar() or 0)
    if used >= limit:
        raise SeatLimitReached(used, limit)


def activate_deployment_token(root: Path, token: str, public_key: bytes,
                              now: Optional[float] = None) -> dict:
    """离线验签部署令牌并落盘。失败返回 {ok:False, reason}。"""
    from chayuan.server.license.token import verify_token
    r = verify_token(token, public_key)
    if not r.get("valid"):
        return {"ok": False, "reason": "bad-signature"}
    p = r.get("payload") or {}
    if p.get("kind") != "seat":
        return {"ok": False, "reason": "not-seat"}
    if str(p.get("fp") or "") != deployment_fingerprint(root):
        return {"ok": False, "reason": "fp-mismatch"}
    now = time.time() if now is None else now
    exp = p.get("exp")
    if not exp or float(exp) <= now:
        return {"ok": False, "reason": "expired"}
    try:
        max_users = int(p["maxUsers"])
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "reason": "bad-payload"}
    write_deployment_license(root, {
        "maxUsers": max_users, "expireAt": float(exp),
        "fp": p["fp"], "token": token, "activatedAt": now,
    })
    return {"ok": True, "maxUsers": max_users, "expireAt": float(exp)}

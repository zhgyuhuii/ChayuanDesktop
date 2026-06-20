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

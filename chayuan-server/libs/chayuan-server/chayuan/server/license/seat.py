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

# 部署指纹位数:16 位小写 hex(8 字节),与客户端 device 指纹(fingerprint.py:
# sha256()[:16])保持一致。历史上曾用 token_hex(16)=32 位,统一收敛到 16 位。
_FP_HEX_LEN = 16


def normalize_fingerprint(fp: str) -> str:
    """规范化部署指纹为 16 位小写 hex。

    - 已是合法 16 位(或更长的合法 hex)→ 取前 16 位(对历史 32 位做*确定性*截断,
      同一部署每次得到同值,稳定可复现)。
    - 为空/非法 → 新生成 16 位 hex。
    """
    s = (fp or "").strip().lower()
    if len(s) >= _FP_HEX_LEN and all(c in "0123456789abcdef" for c in s[:_FP_HEX_LEN]):
        return s[:_FP_HEX_LEN]
    return secrets.token_hex(_FP_HEX_LEN // 2)


class SeatLimitReached(Exception):
    def __init__(self, used: int, limit: int):
        self.used = used
        self.limit = limit
        super().__init__(f"席位已满（{used}/{limit}），请升级网络版席位或停用旧账号。")


def _seat_disabled() -> bool:
    return os.environ.get("CHAYUAN_SEAT_DISABLED", "").strip().lower() in ("1", "true", "yes")


def _file_deployment_fingerprint(root: Path) -> str:
    """单机版:部署指纹存本地 deployment_id.json。规范化为 16 位 hex,
    历史 32 位会被*确定性*截断为 16 位并回写,保证位数与客户端一致且稳定。"""
    p = root / _DEPLOYMENT_ID_FILE
    raw = ""
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        raw = str(data.get("fp") or "")
    except Exception:
        raw = ""
    fp = normalize_fingerprint(raw)
    if fp != raw:  # 新生成 / 截断历史 32 位 → 回写持久化
        try:
            root.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({"fp": fp}), encoding="utf-8")
        except Exception:
            pass
    return fp


def _file_read_license(root: Path) -> Optional[dict]:
    try:
        data = json.loads((root / _DEPLOYMENT_LICENSE_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _file_write_license(root: Path, data: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / _DEPLOYMENT_LICENSE_FILE).write_text(json.dumps(data), encoding="utf-8")


def deployment_fingerprint(root: Path) -> str:
    """部署指纹。单机→本地文件;网络版→共享 DB(seat_store,多节点一致)。"""
    if is_single_machine():
        return _file_deployment_fingerprint(root)
    from chayuan.server.license import seat_store
    return seat_store.get_fingerprint(root)


def read_deployment_license(root: Path) -> Optional[dict]:
    if is_single_machine():
        return _file_read_license(root)
    from chayuan.server.license import seat_store
    return seat_store.read_license(root)


def write_deployment_license(root: Path, data: dict) -> None:
    if is_single_machine():
        _file_write_license(root, data)
        return
    from chayuan.server.license import seat_store
    seat_store.write_license(root, data)


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


def has_active_deployment_license(root: Path, now: Optional[float] = None) -> bool:
    """本部署是否激活了有效(未过期)席位授权。

    - 单机版恒 False(席位是网络版/部署级概念,单机不适用,功能门控走单机自身 license)。
    - 网络版:存在未过期的 deployment_license 即 True(默认未购席位时 license 为空→False)。

    用于功能级门控:有席位授权→per-module 配额/每日免费次数全放行(部署级授权覆盖),
    对话/音转文/视频等不再弹扫码购买。
    """
    if is_single_machine():
        return False
    lic = read_deployment_license(root)
    return bool(lic) and not _expired(lic, now)


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


def activate_deployment_shortcode(root: Path, serial: str, hmac_keys: dict,
                                  now: Optional[float] = None) -> dict:
    """离线验 seat 短码(#16,与客户端短码同机制,HMAC 绑部署指纹)并落盘。

    seat 短码 = 27 字符(8 字节头 kind=2 + 8 字节 HMAC tag)。与 Ed25519 令牌并存,
    互为兼容:用户既可粘 Ed25519 令牌也可粘短码。"""
    from chayuan.server.license.shortcode import verify_shortcode

    fp_hex = deployment_fingerprint(root)
    try:
        fp_bytes = bytes.fromhex(fp_hex)
    except ValueError:
        return {"ok": False, "reason": "bad-fp"}
    r = verify_shortcode(serial, fp_bytes, hmac_keys or {})
    if not r.get("valid"):
        return {"ok": False, "reason": r.get("reason") or "invalid"}
    fields = r.get("fields") or {}
    if fields.get("kind") != 2:  # codec.SEAT_KIND
        return {"ok": False, "reason": "not-seat"}
    import datetime as _dt
    try:
        exp = _dt.datetime.fromisoformat(
            str(r.get("expireAt")).replace("Z", "+00:00")).timestamp()
    except Exception:
        return {"ok": False, "reason": "bad-expire"}
    now = time.time() if now is None else now
    if exp <= now:
        return {"ok": False, "reason": "expired"}
    try:
        max_users = int(r.get("maxUsers") or fields["maxUsers"])
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "reason": "bad-payload"}
    write_deployment_license(root, {
        "maxUsers": max_users, "expireAt": float(exp),
        "fp": fp_hex, "serial": serial, "source": "shortcode", "activatedAt": now,
    })
    return {"ok": True, "maxUsers": max_users, "expireAt": float(exp)}


def _looks_like_shortcode(code: str) -> bool:
    """seat 短码规范化后 27 字符(Base32);Ed25519 令牌含 '.' 且很长。"""
    norm = (code or "").replace("-", "").strip()
    return "." not in code and len(norm) == 27


def activate_deployment(root: Path, code: str, hmac_keys: dict, public_key: bytes,
                        now: Optional[float] = None) -> dict:
    """统一入口:seat 短码 → HMAC 验;否则按 Ed25519 令牌验。两者都支持(#16)。"""
    code = (code or "").strip()
    if not code:
        return {"ok": False, "reason": "empty"}
    if _looks_like_shortcode(code):
        return activate_deployment_shortcode(root, code, hmac_keys, now=now)
    return activate_deployment_token(root, code, public_key, now=now)

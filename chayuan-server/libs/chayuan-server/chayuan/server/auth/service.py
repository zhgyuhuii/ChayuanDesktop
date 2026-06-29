"""用户 / 授权业务层。Repository + service 二合一，够用即可。"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from chayuan.server.auth.password import hash_password, verify_password
from chayuan.server.auth.tokens import create_access_token, create_refresh_token
from chayuan.server.db.models.kb_access_model import KBAccessGrantModel
from chayuan.server.db.models.user_model import UserModel, UserPublicSchema
from chayuan.server.db.session import session_scope

logger = logging.getLogger("chayuan.auth.service")


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------

def get_user_by_id(user_id: int) -> Optional[UserModel]:
    with session_scope() as s:
        u = s.get(UserModel, int(user_id))
        if u:
            s.expunge(u)
        return u


def get_user_by_username(username: str) -> Optional[UserModel]:
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.username == username).one_or_none()
        if u:
            s.expunge(u)
        return u


def list_users(limit: int = 100, offset: int = 0) -> List[UserModel]:
    with session_scope() as s:
        users = (
            s.query(UserModel)
            .order_by(UserModel.id.asc())
            .limit(limit).offset(offset).all()
        )
        for u in users:
            s.expunge(u)
        return users


def admin_exists() -> bool:
    """是否已存在任意 admin 账户(首启向导触发判据:无 admin → 需设置)。"""
    with session_scope() as s:
        return (
            s.query(UserModel.id).filter(UserModel.role == "admin").first()
            is not None
        )


def create_user(
    username: str,
    password: str,
    *,
    role: str = "user",
    roles: Optional[List[str]] = None,
    email: Optional[str] = None,
    dept_id: Optional[int] = None,
) -> UserModel:
    username = (username or "").strip()
    if not username:
        raise ValueError("username required")
    if len(username) > 64:
        raise ValueError("username too long")
    if len(password) < 6:
        raise ValueError("password too short (>= 6)")

    # 角色列表:roles 优先,否则单 role;逐个对已存在角色校验,未知丢弃;空 → ["user"]
    raw = list(roles) if roles else [role]
    valid: List[str] = []
    for r in raw:
        r = (r or "").strip()
        if not r:
            continue
        if r in ("admin", "user"):
            if r not in valid:
                valid.append(r)
            continue
        try:
            from chayuan.server.db.repository import role_repository as _roles
            if _roles.get_role(r) is not None and r not in valid:
                valid.append(r)
        except Exception:  # noqa: BLE001
            pass
    if not valid:
        valid = ["user"]
    primary = "admin" if "admin" in valid else valid[0]

    from chayuan.server.license.seat import assert_seat_available
    assert_seat_available()

    pw = hash_password(password)
    try:
        with session_scope() as s:
            u = UserModel(
                username=username, email=email, password_hash=pw,
                role=primary, is_active=True, dept_id=dept_id,
            )
            s.add(u)
            s.flush()
            s.refresh(u)
            s.expunge(u)
    except IntegrityError as e:
        raise ValueError(f"username '{username}' already exists") from e

    from chayuan.server.db.repository import user_role_repository as urr
    urr.set_user_roles(u.id, valid)
    return u


def set_user_dept(user_id: int, dept_id: Optional[int]) -> None:
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.id == user_id).one_or_none()
        if u is None:
            raise ValueError("user not found")
        u.dept_id = dept_id


def soft_delete_user(user_id: int) -> None:
    """软删:停用账号(保留数据与角色)。"""
    with session_scope() as s:
        u = s.query(UserModel).filter(UserModel.id == user_id).one_or_none()
        if u is None:
            raise ValueError("user not found")
        u.is_active = False


def set_password(user_id: int, new_password: str) -> None:
    if len(new_password) < 6:
        raise ValueError("password too short (>= 6)")
    pw = hash_password(new_password)
    with session_scope() as s:
        u = s.get(UserModel, int(user_id))
        if u is None:
            raise ValueError("user not found")
        u.password_hash = pw


def set_active(user_id: int, is_active: bool) -> None:
    with session_scope() as s:
        u = s.get(UserModel, int(user_id))
        if u is None:
            raise ValueError("user not found")
        u.is_active = bool(is_active)


# ---------------------------------------------------------------------------
# 登录 / token 签发
# ---------------------------------------------------------------------------

class AuthError(Exception):
    pass


def authenticate(username: str, password: str) -> UserModel:
    u = get_user_by_username(username)
    if u is None:
        raise AuthError("user not found")
    if not u.is_active:
        raise AuthError("user disabled")
    if not verify_password(password, u.password_hash or ""):
        raise AuthError("bad password")

    with session_scope() as s:
        db_u = s.get(UserModel, u.id)
        if db_u is not None:
            db_u.last_login_at = datetime.utcnow()

    return u


def issue_token_pair(u: UserModel) -> Tuple[str, str]:
    return (
        create_access_token(u.id, u.username, u.role or "user"),
        create_refresh_token(u.id, u.username),
    )


# ---------------------------------------------------------------------------
# 首次启动：种子 admin
# ---------------------------------------------------------------------------

def bootstrap_default_admin() -> Optional[Tuple[str, str]]:
    """仅当显式配置了 ``AUTH_DEFAULT_ADMIN_PASSWORD`` 时预建 admin;否则不建,
    交给前端首启向导(``POST /auth/setup``)设置首个管理员。

    机制1(2026-06-18):去掉"留空则随机生成 + 打日志"——那会让用户表在任何
    web 访问之前就非空,导致首启向导永不触发。无显式密码时返回 None。
    返回 (username, password) 仅用于日志(运维显式预置场景)。
    """
    from chayuan.settings import Settings

    with session_scope() as s:
        if s.query(UserModel.id).first() is not None:
            return None

    bs = Settings.basic_settings
    username = (getattr(bs, "AUTH_DEFAULT_ADMIN_USERNAME", "admin") or "admin").strip() or "admin"
    password = (getattr(bs, "AUTH_DEFAULT_ADMIN_PASSWORD", "") or "").strip()
    if not password:
        logger.info(
            "未配置 AUTH_DEFAULT_ADMIN_PASSWORD,跳过预建 admin,等待首启向导设置"
        )
        return None

    try:
        create_user(username, password, role="admin")
        return username, password
    except ValueError as e:
        logger.warning("bootstrap admin failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# KB ACL
# ---------------------------------------------------------------------------

def grant_kb_access(kb_id: int, user_id: int, role: str, granted_by: Optional[int]) -> None:
    if role not in ("reader", "editor"):
        raise ValueError("role must be reader/editor")
    with session_scope() as s:
        existing = (
            s.query(KBAccessGrantModel)
            .filter(KBAccessGrantModel.kb_id == kb_id,
                    KBAccessGrantModel.user_id == user_id)
            .one_or_none()
        )
        if existing:
            existing.role = role
            existing.granted_by = granted_by
            return
        s.add(KBAccessGrantModel(
            kb_id=kb_id, user_id=user_id, role=role, granted_by=granted_by,
        ))


def revoke_kb_access(kb_id: int, user_id: int) -> None:
    with session_scope() as s:
        s.query(KBAccessGrantModel).filter(
            KBAccessGrantModel.kb_id == kb_id,
            KBAccessGrantModel.user_id == user_id,
        ).delete(synchronize_session=False)


def list_kb_grants(kb_id: int) -> List[KBAccessGrantModel]:
    with session_scope() as s:
        rows = (
            s.query(KBAccessGrantModel)
            .filter(KBAccessGrantModel.kb_id == kb_id).all()
        )
        for r in rows:
            s.expunge(r)
        return rows

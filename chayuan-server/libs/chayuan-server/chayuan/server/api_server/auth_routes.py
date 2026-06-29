"""/auth/* 路由。

- POST /auth/register：开放注册（受 `AUTH_ALLOW_REGISTRATION` 控制）；
- POST /auth/login：签发 access + refresh token；
- POST /auth/refresh：拿 refresh token 换一对新 token；
- GET  /auth/me：拿到当前用户资料；
- POST /auth/logout：客户端直接扔掉 token 即可；这里仅回 204 方便前端调用。
- GET  /auth/users：管理员看用户列表；
- POST /auth/users：管理员新增用户；
- PATCH /auth/users/{id}/password：管理员或本人改密；
- PATCH /auth/users/{id}/active：管理员启/禁用。

所有路由 ** 都显式**写了依赖，而不是通过全局中间件拦；这样调试更直观。
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

# Cookie 名固定;前端如果走 cookie 模式直接 credentials='include' 即可,
# JS 侧不需要也不应该读这两个 cookie(HttpOnly)
_COOKIE_ACCESS = "chayuan_access_token"
_COOKIE_REFRESH = "chayuan_refresh_token"


def _cookie_kwargs(token_kind: str) -> Dict[str, Any]:
    """统一的 cookie 设置:HttpOnly + SameSite=Lax;dev 走 http 也允许(secure=False)。
    生产 https 部署应在反代层把 secure 升 True(本进程不感知 scheme)。"""
    from chayuan.settings import Settings
    if token_kind == "access":
        max_age = int(getattr(Settings.basic_settings, "JWT_ACCESS_TTL_MIN", 60)) * 60
    else:
        max_age = int(getattr(Settings.basic_settings, "JWT_REFRESH_TTL_DAY", 14)) * 86400
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": False,  # 反代 HTTPS 时浏览器仍按 https 发;开发 http 不能强 True
        "max_age": max_age,
        "path": "/",
    }


def _set_token_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(_COOKIE_ACCESS, access, **_cookie_kwargs("access"))
    response.set_cookie(_COOKIE_REFRESH, refresh, **_cookie_kwargs("refresh"))


def _clear_token_cookies(response: Response) -> None:
    response.delete_cookie(_COOKIE_ACCESS, path="/")
    response.delete_cookie(_COOKIE_REFRESH, path="/")
from pydantic import BaseModel, Field

from chayuan.server.auth import service as svc
from chayuan.server.auth.deps import get_current_user, require_role
from chayuan.server.auth.tokens import TokenError, decode_token
from chayuan.server.db.models.user_model import UserPublicSchema

logger = logging.getLogger("chayuan.auth.routes")

auth_router = APIRouter(prefix="/auth", tags=["Auth 多用户鉴权"])

# 首启 setup 竞态锁:进程内串行化"无 admin 才建"的检查+创建
_SETUP_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class _LoginBody(BaseModel):
    username: str
    password: str


class _RegisterBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=256)
    email: Optional[str] = None


class _SetupBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=256)
    instance_name: Optional[str] = None


class _RefreshBody(BaseModel):
    refresh_token: str


class _TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserPublicSchema


class _CreateUserBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=256)
    role: str = "user"
    email: Optional[str] = None
    dept_id: Optional[int] = None
    roles: Optional[List[str]] = None


class _ChangePasswordBody(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=256)
    old_password: Optional[str] = None


def _user_public(u) -> "UserPublicSchema":
    """序列化用户为公开 schema,附带多角色与所属部门(向后兼容)。"""
    from chayuan.server.db.repository import user_role_repository as urr
    data = UserPublicSchema.model_validate(u).model_dump()
    data["roles"] = urr.get_user_roles(int(u.id))
    data["dept_id"] = getattr(u, "dept_id", None)
    return UserPublicSchema.model_validate(data)


# ---------------------------------------------------------------------------
# 公开端点
# ---------------------------------------------------------------------------

@auth_router.get(
    "/config",
    summary="公开:鉴权策略",
)
def auth_config() -> Dict[str, Any]:
    """前端在启动时拉一次,根据 `auth_required` 决定:
    - true  → 主页就弹登录框,不允许游客 / 不允许关闭弹框
    - false → 走游客态;登录是可选

    `auth_allow_registration` 控制注册入口是否显示。
    无需鉴权访问;字段全是布尔,不暴露任何敏感信息。
    """
    from chayuan.settings import Settings
    return {
        "auth_required": bool(getattr(Settings.basic_settings, "AUTH_REQUIRED", False)),
        "auth_allow_registration": bool(
            getattr(Settings.basic_settings, "AUTH_ALLOW_REGISTRATION", True)
        ),
        "admin_setup_required": not svc.admin_exists(),
        "instance_name": getattr(Settings.basic_settings, "CHAYUAN_INSTANCE_NAME", "") or "",
    }


@auth_router.post(
    "/register",
    response_model=UserPublicSchema,
    status_code=status.HTTP_201_CREATED,
    summary="注册",
)
def register(body: _RegisterBody):
    from chayuan.settings import Settings
    if not bool(getattr(Settings.basic_settings, "AUTH_ALLOW_REGISTRATION", True)):
        raise HTTPException(status_code=403, detail="self-registration disabled")

    try:
        u = svc.create_user(body.username, body.password, email=body.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return UserPublicSchema.model_validate(u)


@auth_router.post("/setup", response_model=_TokenPair, summary="首启:设置首个管理员")
def setup(body: _SetupBody, response: Response):
    """仅当系统尚无任何 admin 时可用:创建首个 admin 并直接登录。

    竞态安全:进程内锁 + 锁内重查 ``admin_exists()``;已存在 admin 返 409
    (防两个首访者各建一个 admin)。"""
    with _SETUP_LOCK:
        if svc.admin_exists():
            raise HTTPException(status_code=409, detail="admin already exists")
        try:
            u = svc.create_user(body.username, body.password, role="admin")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if body.instance_name:
        name = body.instance_name.strip()
        try:
            from chayuan.settings import Settings
            # 先更新内存(running 进程的 /auth/config 立即反映),再持久化到 yaml
            try:
                setattr(Settings.basic_settings, "CHAYUAN_INSTANCE_NAME", name)
            except Exception:  # noqa: BLE001
                pass
            from chayuan.server.config_panel import yaml_store
            yaml_store.save_updates("basic_settings.yaml", {"CHAYUAN_INSTANCE_NAME": name})
        except Exception as e:  # noqa: BLE001
            logger.warning("写实例标识失败(忽略): %r", e)
    access, refresh = svc.issue_token_pair(u)
    _set_token_cookies(response, access, refresh)
    return _TokenPair(
        access_token=access,
        refresh_token=refresh,
        user=UserPublicSchema.model_validate(u),
    )


@auth_router.post("/login", response_model=_TokenPair, summary="登录")
def login(body: _LoginBody, response: Response):
    try:
        u = svc.authenticate(body.username, body.password)
    except svc.AuthError as e:
        logger.warning(
            "login failed: username=%r reason=%s",
            (body.username or "")[:64], str(e) or "unknown",
        )
        raise HTTPException(
            status_code=401, detail="invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access, refresh = svc.issue_token_pair(u)
    # 同时下发 HttpOnly cookie + body token:
    # - body 兼容现有 Bearer 模式前端
    # - cookie 让走 credentials='include' 模式的前端不必在 JS 里持有 token(防 XSS)
    _set_token_cookies(response, access, refresh)
    return _TokenPair(
        access_token=access,
        refresh_token=refresh,
        user=UserPublicSchema.model_validate(u),
    )


@auth_router.post("/refresh", response_model=_TokenPair, summary="刷新 token")
def refresh(request: Request, response: Response, body: Optional[_RefreshBody] = None):
    # 优先取 body.refresh_token(Bearer 模式),fallback 取 cookie(cookie 模式)
    refresh_tok = (body.refresh_token if body else "") or request.cookies.get(_COOKIE_REFRESH) or ""
    refresh_tok = refresh_tok.strip()
    if not refresh_tok:
        raise HTTPException(status_code=401, detail="refresh token missing")
    try:
        decoded = decode_token(refresh_tok, expected_type="refresh")
    except TokenError as e:
        raise HTTPException(status_code=401, detail=f"refresh token invalid: {e}")
    if decoded.user_id is None:
        raise HTTPException(status_code=401, detail="refresh token invalid: no sub")
    u = svc.get_user_by_id(decoded.user_id)
    if u is None or not u.is_active:
        raise HTTPException(status_code=401, detail="user gone or disabled")
    access, new_refresh = svc.issue_token_pair(u)
    _set_token_cookies(response, access, new_refresh)
    return _TokenPair(
        access_token=access,
        refresh_token=new_refresh,
        user=UserPublicSchema.model_validate(u),
    )


@auth_router.get("/me", response_model=UserPublicSchema, summary="当前用户资料")
def me(user: Dict[str, Any] = Depends(get_current_user)):
    full = svc.get_user_by_id(int(user["id"]))
    if full is None:
        raise HTTPException(status_code=404, detail="user not found")
    return _user_public(full)


@auth_router.get("/me/modules", summary="当前用户可见的模块(后台 + 前端功能,RBAC #2)")
def my_modules(user: Dict[str, Any] = Depends(get_current_user)):
    """前端据此门控后台菜单 + 前端功能(app.* 键)。

    - admin → 全部模块(is_admin=true)。
    - 其它角色 → 该角色 modules;未知 → []。
    - single_machine:单机部署(AUTH_REQUIRED=false 的桌面版)→ 前端不做任何功能限制(机主自用)。
    - is_guest:网络游客(未登录 + 放行)→ 按其默认角色(user)的 app.* 授权管控,
      admin 可通过配置「user」角色的前端功能勾选项来限制游客可见功能。
    """
    from chayuan.server.db.repository import role_repository as repo
    uid = int(user.get("id") or 0)
    if uid > 0:
        from chayuan.server.db.repository import user_role_repository as urr
        full = svc.get_user_by_id(uid)
        dept_id = getattr(full, "dept_id", None) if full else None
        eff_roles = urr.effective_roles(uid, dept_id)
        if not eff_roles:
            eff_roles = [str(user.get("role") or "user")]
    else:
        eff_roles = [str(user.get("role") or "user")]  # 游客:用其默认角色
    modules = repo.effective_modules_multi(eff_roles)
    primary = "admin" if "admin" in eff_roles else (eff_roles[0] if eff_roles else "user")
    try:
        from chayuan.server.profiles import is_single_machine
        single_machine = bool(is_single_machine())
    except Exception:  # noqa: BLE001
        single_machine = False
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "role": primary,
            "roles": eff_roles,
            "is_admin": "admin" in eff_roles,
            "is_guest": bool(user.get("is_guest")),
            "single_machine": single_machine,
            "modules": modules,
        },
    }


@auth_router.get("/me/summary", summary="当前用户资料 + 汇总计数")
def me_summary(user: Dict[str, Any] = Depends(get_current_user)):
    """给前端用的轻量接口，一次拿全：资料 / 拥有 KB 数 / 会话数。"""
    from chayuan.server.db.session import session_scope
    from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
    from chayuan.server.db.models.conversation_model import ConversationModel

    full = svc.get_user_by_id(int(user["id"]))
    if full is None:
        raise HTTPException(status_code=404, detail="user not found")

    uid = int(user["id"])
    with session_scope() as s:
        kb_owned = s.query(KnowledgeBaseModel).filter(
            KnowledgeBaseModel.owner_id == uid
        ).count()
        conv_count = s.query(ConversationModel).filter(
            ConversationModel.user_id == uid
        ).count()

    return {
        "user": UserPublicSchema.model_validate(full).model_dump(mode="json"),
        "stats": {
            "kb_owned": int(kb_owned),
            "conversations": int(conv_count),
        },
    }


@auth_router.post(
    "/logout",
    response_class=Response,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="登出（前端丢 token 即可）",
)
def logout():
    # JWT 无状态，服务端无需作为；若做吊销，需要引入 jti 黑名单（Redis）
    # 注意：新版 FastAPI 在 204 时会强校验「函数不得声明返回体」，
    # 这里用 Response() 显式返回空 body，避免启动时 AssertionError。
    # 同时清掉 cookie:cookie 模式的客户端无法在 JS 删 HttpOnly cookie,必须服务端帮删
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_token_cookies(resp)
    return resp


# ---------------------------------------------------------------------------
# 管理员端点
# ---------------------------------------------------------------------------

@auth_router.get(
    "/users", response_model=List[UserPublicSchema], summary="[admin] 列用户"
)
def admin_list_users(cur: Dict[str, Any] = Depends(require_role("admin")), limit: int = 100, offset: int = 0):
    from chayuan.server.db.repository import user_role_repository as urr
    from chayuan.server.db.session import session_scope
    from chayuan.server.db.models.user_model import UserModel as _U
    uid = int(cur.get("id") or 0)
    # admin 主角色一律看全部(覆盖 data_scope:既符合现实,也避免注入态 admin 无 DB 行时退化成 self)
    if cur.get("role") == "admin":
        mode, ids = "all", None
    elif uid > 0:
        full = svc.get_user_by_id(uid)
        dept_id = getattr(full, "dept_id", None) if full else None
        mode, ids = urr.data_scope(uid, dept_id)
    else:
        mode, ids = "all", None
    with session_scope() as s:
        q = s.query(_U)
        if mode == "depts":
            q = q.filter(_U.dept_id.in_(list(ids)))
        elif mode == "self":
            q = q.filter(_U.id == uid)
        rows = q.order_by(_U.id).offset(offset).limit(limit).all()
        return [_user_public(u) for u in rows]


@auth_router.post(
    "/users", response_model=UserPublicSchema,
    status_code=status.HTTP_201_CREATED, summary="[admin] 新建用户"
)
def admin_create_user(
    body: _CreateUserBody,
    _=Depends(require_role("admin")),
):
    try:
        u = svc.create_user(
            body.username, body.password,
            role=body.role, roles=body.roles, email=body.email, dept_id=body.dept_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _user_public(u)


@auth_router.patch("/users/{user_id}/password", summary="改密（admin 或本人）")
def change_password(
    user_id: int,
    body: _ChangePasswordBody,
    cur: Dict[str, Any] = Depends(get_current_user),
):
    is_admin = cur.get("role") == "admin"
    is_self = int(cur.get("id")) == int(user_id)
    if not (is_admin or is_self):
        raise HTTPException(status_code=403, detail="forbidden")

    if is_self and not is_admin:
        if not body.old_password:
            raise HTTPException(status_code=400, detail="old_password required")
        u = svc.get_user_by_id(user_id)
        if u is None:
            raise HTTPException(status_code=404, detail="user not found")
        from chayuan.server.auth.password import verify_password
        if not verify_password(body.old_password, u.password_hash or ""):
            raise HTTPException(status_code=400, detail="old password mismatch")

    try:
        svc.set_password(user_id, body.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok"}


@auth_router.patch("/users/{user_id}/active", summary="[admin] 启/禁用账号")
def set_active(
    user_id: int,
    is_active: bool,
    _=Depends(require_role("admin")),
):
    try:
        svc.set_active(user_id, is_active)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok"}


class _SetRolesBody(BaseModel):
    roles: List[str] = []


@auth_router.put("/users/{user_id}/roles", summary="[admin] 设置用户多角色")
def set_user_roles_route(user_id: int, body: _SetRolesBody, _=Depends(require_role("admin"))):
    from chayuan.server.db.repository import user_role_repository as urr
    urr.set_user_roles(user_id, body.roles)
    return {"code": 0, "msg": "ok", "data": {"roles": urr.get_user_roles(user_id)}}


class _SetDeptBody(BaseModel):
    dept_id: Optional[int] = None


@auth_router.patch("/users/{user_id}/dept", summary="[admin] 设置用户所属部门")
def set_user_dept_route(user_id: int, body: _SetDeptBody, _=Depends(require_role("admin"))):
    try:
        svc.set_user_dept(user_id, body.dept_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"code": 0, "msg": "ok"}


@auth_router.delete("/users/{user_id}", summary="[admin] 软删用户(停用)")
def delete_user_route(user_id: int, _=Depends(require_role("admin"))):
    try:
        svc.soft_delete_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"code": 0, "msg": "ok"}

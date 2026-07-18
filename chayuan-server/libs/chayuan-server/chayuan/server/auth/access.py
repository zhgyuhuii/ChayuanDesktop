"""KB 访问控制集中点。`_check_kb_*` 返回三态：

- "owner"   → owner_id 匹配；
- "editor"  → 在 grants 表里角色是 editor；
- "reader"  → 在 grants 表里角色是 reader；或 visibility=public；
- None      → 无权访问（或资源不存在）。

admin 始终拥有 owner 级权限。
"""
from __future__ import annotations

import logging
from typing import List, Optional, Tuple

from chayuan.server.db.models.kb_access_model import KBAccessGrantModel
from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
from chayuan.server.db.session import session_scope

logger = logging.getLogger("chayuan.auth.access")


def _get_kbs_by_name(name: str) -> List[KnowledgeBaseModel]:
    """按名取 KB。返回【列表】——kb_name 没有唯一约束(只有 vector_namespace
    唯一),多用户服务版里不同 owner 可建同名 KB,历史数据也可能有重复行。
    ⚠ 血泪:原来用 .one_or_none() 假设全局唯一,同名多行时直接
    MultipleResultsFound 500(删库/鉴权全崩)。改成取全部,由调用方按用户
    聚合权限。按 id 升序保证确定性。"""
    with session_scope() as s:
        kbs = (
            s.query(KnowledgeBaseModel)
            .filter(KnowledgeBaseModel.kb_name == name)
            .order_by(KnowledgeBaseModel.id.asc())
            .all()
        )
        for kb in kbs:
            s.expunge(kb)
        return kbs


def _get_kb_by_name(name: str) -> Optional[KnowledgeBaseModel]:
    """兼容旧调用:同名多行时取 id 最小的一行,不再崩溃。"""
    kbs = _get_kbs_by_name(name)
    return kbs[0] if kbs else None


def _grant_role(kb_id: int, user_id: int) -> Optional[str]:
    with session_scope() as s:
        g = (
            s.query(KBAccessGrantModel)
            .filter(
                KBAccessGrantModel.kb_id == kb_id,
                KBAccessGrantModel.user_id == user_id,
            )
            .one_or_none()
        )
        return g.role if g else None


def _ancestors_set(ancestors):
    if not ancestors:
        return set()
    return {int(x) for x in str(ancestors).split(",") if x.strip().isdigit()}


def _grant_role_multi(kb_id, user):
    """多主体(user/role/dept)聚合,返回 'editor'|'reader'|None。editor 优先。"""
    from chayuan.server.db.repository import kb_grant_repository as kg
    grants = kg.list_grants(int(kb_id))
    if not grants:
        return None
    uid = (user.get("id") if isinstance(user, dict) else getattr(user, "id", None)) if user else None
    rank = {"reader": 1, "editor": 2}
    best = 0

    def _bump(r):
        nonlocal best
        best = max(best, rank.get(r, 0))

    # 用户直接授权
    if uid is not None:
        sid = str(uid)
        for g in grants:
            if g["subject_type"] == "user" and g["subject_id"] == sid:
                _bump(g["role"])

    # 仅当存在 role/dept 授权才查有效角色/部门链(省热路径开销)
    has_rd = any(g["subject_type"] in ("role", "dept") for g in grants)
    if has_rd and uid is not None and uid > 0:
        from chayuan.server.db.repository import user_role_repository as urr
        from chayuan.server.auth import service as _svc
        full = _svc.get_user_by_id(int(uid))
        dept_id = getattr(full, "dept_id", None) if full else None
        eff = set(urr.effective_roles(int(uid), dept_id))
        for g in grants:
            if g["subject_type"] == "role" and g["subject_id"] in eff:
                _bump(g["role"])
        if dept_id is not None:
            from chayuan.server.db.repository import dept_repository as dr
            d = dr.get_dept(int(dept_id))
            chain = _ancestors_set(d["ancestors"]) if d else {int(dept_id)}
            for g in grants:
                if g["subject_type"] != "dept":
                    continue
                try:
                    gd = int(g["subject_id"])
                except (TypeError, ValueError):
                    continue
                if gd in chain and (gd == int(dept_id) or g["include_subtree"]):
                    _bump(g["role"])

    return {2: "editor", 1: "reader"}.get(best)


def kb_access_for(user, kb_name: str) -> Optional[str]:
    """返回用户对指定 KB 的有效角色："owner" / "editor" / "reader" / None。

    ``user`` 可以是 None（未登录）；None 只能读 public KB。

    应用账号路径（plan v1.3 §4.3）：当 ``user.id`` 形如 ``"app:<app_id>"`` 时，
    委托给 ``auth.app_acl`` 处理；应用账号永远不是 owner，最高 editor。
    """
    # 应用账号短路（先做，避免下面 owner_id == uid 的 int 比较把 "app:xxx" 拿去比）
    from chayuan.server.auth import app_acl as _app_acl  # 局部 import 避免循环
    if _app_acl.is_app_user(user):
        return _app_acl.app_kb_role(_app_acl.extract_app_id(user), kb_name)

    kbs = _get_kbs_by_name(kb_name)
    if not kbs:
        return None

    # admin 通吃
    if user is not None and (user.get("role") if isinstance(user, dict) else getattr(user, "role", "")) == "admin":
        return "owner"

    uid = (user.get("id") if isinstance(user, dict) else getattr(user, "id", None)) if user else None

    # 同名可能有多行（kb_name 非唯一）：对每一行算出用户的有效角色，取最高。
    # 任一行 owner_id 命中即 owner —— 保证用户能删/管自己那一个。
    _rank = {"owner": 3, "editor": 2, "reader": 1}
    best: Optional[str] = None

    def _bump(role: Optional[str]):
        nonlocal best
        if role and (_rank.get(role, 0) > _rank.get(best, 0)):
            best = role

    for kb in kbs:
        # legacy KB（owner_id 为空）：所有登录用户 reader；未登录仅 public 可读
        if kb.owner_id is None:
            _bump("reader" if uid is not None else ("reader" if kb.visibility == "public" else None))
            continue
        if uid is not None and kb.owner_id == uid:
            _bump("owner")
            continue
        if uid is not None:
            _bump(_grant_role_multi(kb.id, user))
        if kb.visibility == "public":
            _bump("reader")

    return best


def can_read_kb(user, kb_name: str) -> bool:
    return kb_access_for(user, kb_name) in ("owner", "editor", "reader")


def can_write_kb(user, kb_name: str) -> bool:
    return kb_access_for(user, kb_name) in ("owner", "editor")


def is_kb_owner(user, kb_name: str) -> bool:
    return kb_access_for(user, kb_name) == "owner"


def list_accessible_kbs(user) -> List[str]:
    """返回用户有"至少 reader"权限的所有 KB 名字（admin 全拿）。

    应用账号路径（plan v1.3 §4.3）：委托 ``auth.app_acl.list_app_accessible_kbs``。
    """
    from chayuan.server.auth import app_acl as _app_acl  # 局部 import 避免循环
    if _app_acl.is_app_user(user):
        return _app_acl.list_app_accessible_kbs(_app_acl.extract_app_id(user))

    uid = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    role = user.get("role") if isinstance(user, dict) else getattr(user, "role", "")

    with session_scope() as s:
        q = s.query(KnowledgeBaseModel)
        if role == "admin":
            rows = q.all()
            out = [kb.kb_name for kb in rows]
        else:
            all_kbs = q.all()
            out = []
            for kb in all_kbs:
                # legacy 共享 KB（owner_id=None）：登录用户都可见
                if kb.owner_id is None and uid is not None:
                    out.append(kb.kb_name)
                    continue
                if kb.visibility == "public":
                    out.append(kb.kb_name)
                    continue
                if uid is not None and kb.owner_id == uid:
                    out.append(kb.kb_name)
                    continue
                if uid is not None and _grant_role_multi(kb.id, user) is not None:
                    out.append(kb.kb_name)
                    continue
        return out


def set_kb_owner_if_missing(kb_name: str, user_id: Optional[int]) -> None:
    """新建 KB 时补 owner。如果 owner_id 已经有值则不动。"""
    if user_id is None:
        return
    with session_scope() as s:
        # kb_name 非唯一,同名可能多行;给所有【缺 owner】的同名行补上,不用
        # .one_or_none()(会 MultipleResultsFound 崩)。
        kbs = (
            s.query(KnowledgeBaseModel)
            .filter(KnowledgeBaseModel.kb_name == kb_name)
            .all()
        )
        for kb in kbs:
            if kb.owner_id is None:
                kb.owner_id = int(user_id)

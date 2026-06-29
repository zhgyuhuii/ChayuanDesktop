"""KB 泛化授权仓库（主体 user/role/dept）。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from chayuan.server.db.models.kb_subject_grant_model import KbSubjectGrantModel
from chayuan.server.db.session import session_scope

_SUBJECT_TYPES = ("user", "role", "dept")
_ROLES = ("reader", "editor")


def add_grant(kb_id: int, subject_type: str, subject_id: str, role: str,
              include_subtree: bool = False, granted_by: Optional[int] = None) -> Dict[str, Any]:
    if subject_type not in _SUBJECT_TYPES:
        raise ValueError("subject_type 必须是 user/role/dept")
    if role not in _ROLES:
        raise ValueError("role 必须是 reader/editor")
    subject_id = str(subject_id)
    with session_scope() as s:
        g = s.query(KbSubjectGrantModel).filter(
            KbSubjectGrantModel.kb_id == kb_id,
            KbSubjectGrantModel.subject_type == subject_type,
            KbSubjectGrantModel.subject_id == subject_id,
        ).one_or_none()
        if g is None:
            g = KbSubjectGrantModel(kb_id=kb_id, subject_type=subject_type, subject_id=subject_id)
            s.add(g)
        g.role = role
        g.include_subtree = bool(include_subtree)
        g.granted_by = granted_by
        s.flush()
        return _to_dict(g)


def revoke_grant(kb_id: int, subject_type: str, subject_id: str) -> bool:
    with session_scope() as s:
        n = s.query(KbSubjectGrantModel).filter(
            KbSubjectGrantModel.kb_id == kb_id,
            KbSubjectGrantModel.subject_type == subject_type,
            KbSubjectGrantModel.subject_id == str(subject_id),
        ).delete(synchronize_session=False)
        return bool(n)


def list_grants(kb_id: int) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.query(KbSubjectGrantModel).filter(KbSubjectGrantModel.kb_id == kb_id).all()
        return [_to_dict(g) for g in rows]


def _to_dict(g: "KbSubjectGrantModel") -> Dict[str, Any]:
    return {
        "subject_type": g.subject_type,
        "subject_id": g.subject_id,
        "role": g.role,
        "include_subtree": bool(g.include_subtree),
        "granted_by": g.granted_by,
    }

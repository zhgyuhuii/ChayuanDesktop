"""用户运营聚合(框架无关)。config_panel users_page 与 admin REST 共用。

P1 最小版:users[] + KPI。P2 扩展 daily/top-N/heatmap/matrix/feedback。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope

_LOOKBACK_DAYS = 400


def _est_tokens(text_len: int) -> int:
    return int(text_len / 1.5)


def build_users_snapshot(now: Optional[datetime] = None) -> dict:
    now = now or datetime.now()
    cutoff = now - timedelta(days=_LOOKBACK_DAYS)
    seven = now - timedelta(days=7)
    with session_scope() as s:
        users = s.query(UserModel).all()
        umap = {
            u.id: {
                "id": u.id, "username": u.username, "role": u.role,
                "email": u.email, "is_active": bool(u.is_active),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                "msg_count": 0, "est_tokens": 0, "last_active": None,
            }
            for u in users
        }
        rows = (
            s.query(
                MessageModel.user_id, MessageModel.query,
                MessageModel.response, MessageModel.create_time,
            )
            .filter(MessageModel.create_time >= cutoff)
            .all()
        )
        for uid, q, r, ct in rows:
            rec = umap.get(uid)
            if rec is None:
                continue
            rec["msg_count"] += 1
            rec["est_tokens"] += _est_tokens(len(q or "") + len(r or ""))
            if ct and (rec["last_active"] is None or ct.isoformat() > rec["last_active"]):
                rec["last_active"] = ct.isoformat()

    users_list = sorted(umap.values(), key=lambda x: (-x["est_tokens"], x["id"]))
    seven_iso = seven.isoformat()
    return {
        "users": users_list,
        "total_users": len(users_list),
        "active_7d": sum(1 for u in users_list if u["last_active"] and u["last_active"] >= seven_iso),
        "total_messages": sum(u["msg_count"] for u in users_list),
        "total_tokens": sum(u["est_tokens"] for u in users_list),
        "generated_at": now.timestamp(),
    }

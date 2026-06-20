from __future__ import annotations
from datetime import datetime, timedelta
import uuid
import pytest
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.session import session_scope
from chayuan.server.admin.users_analytics import build_users_snapshot, _est_tokens


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    def _purge():
        with session_scope() as s:
            s.query(MessageModel).delete()
            s.query(UserModel).delete()
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")  # 不触发席位守卫
    _purge(); yield; _purge()


def _add_msg(uid, q, r, when):
    with session_scope() as s:
        s.add(MessageModel(id=uuid.uuid4().hex, user_id=uid, chat_type="chat",
                           query=q, response=r, create_time=when))


def test_snapshot_users_and_kpi():
    now = datetime(2026, 6, 20, 12, 0, 0)
    u1 = svc.create_user("alice", "secret123", role="admin")
    u2 = svc.create_user("bob", "secret123", role="user")
    _add_msg(u1.id, "hi", "hello", now - timedelta(days=1))      # len 2+5=7
    _add_msg(u1.id, "x" * 15, "y" * 15, now - timedelta(days=1)) # len 30
    _add_msg(u2.id, "q", "r", now - timedelta(days=30))          # 7日外

    snap = build_users_snapshot(now=now)
    assert snap["total_users"] == 2
    assert snap["total_messages"] == 3
    assert snap["active_7d"] == 1                                 # 仅 alice 近7日
    by = {u["username"]: u for u in snap["users"]}
    assert by["alice"]["msg_count"] == 2
    assert by["bob"]["msg_count"] == 1
    # alice est = int(7/1.5)+int(30/1.5) = 4 + 20 = 24
    assert by["alice"]["est_tokens"] == _est_tokens(7) + _est_tokens(30)
    assert snap["total_tokens"] == by["alice"]["est_tokens"] + by["bob"]["est_tokens"]
    assert "generated_at" in snap


def test_empty_db_ok():
    snap = build_users_snapshot()
    assert snap["total_users"] == 0 and snap["users"] == []
    assert snap["total_messages"] == 0 and snap["active_7d"] == 0

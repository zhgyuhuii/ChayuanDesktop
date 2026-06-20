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


def test_snapshot_rich_aggregation():
    """P2 全聚合:top_model / heatmap / daily / feedback_hist / matrix。"""
    from datetime import datetime, timedelta
    now = datetime(2026, 6, 20, 12, 0, 0)
    u1 = svc.create_user("carol", "secret123", role="user")
    # 同模型 2 条 + 反馈
    with session_scope() as s:
        s.add(MessageModel(id=uuid.uuid4().hex, user_id=u1.id, chat_type="llm_chat",
                           query="aaa", response="bbb", meta_data={"model": "qwen"},
                           feedback_score=90, create_time=now - timedelta(days=1)))
        s.add(MessageModel(id=uuid.uuid4().hex, user_id=u1.id, chat_type="kb_chat",
                           query="ccc", response="ddd", meta_data={"model": "qwen", "kb_name": "FAQ"},
                           create_time=now - timedelta(days=2)))
    snap = build_users_snapshot(now=now)
    # top_model
    assert snap["top_model"][0] == {"name": "qwen", "count": 2}
    assert any(d["name"] == "FAQ" for d in snap["top_kb"])
    assert {"name": "llm_chat", "count": 1} in snap["top_chat_type"]
    # heatmap 结构 7x24 + 有计数
    assert len(snap["global_heatmap"]) == 7 and len(snap["global_heatmap"][0]) == 24
    assert snap["global_heatmap_max"] >= 1
    # daily 序列 30 天
    assert len(snap["daily_msg"]) == 30 and len(snap["daily_active"]) == 30
    # feedback
    assert snap["total_feedback"] == 1 and snap["feedback_hist"][4] == 1  # 90 落在 80-100 桶
    # per-user 富字段
    carol = next(u for u in snap["users"] if u["username"] == "carol")
    assert carol["model_usage"]["qwen"] == 2
    assert len(carol["recent_queries"]) == 2

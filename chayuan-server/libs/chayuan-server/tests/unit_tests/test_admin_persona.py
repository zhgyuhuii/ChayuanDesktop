from __future__ import annotations
import pytest
from chayuan.server.admin import persona as P


def test_persona_user_not_found(monkeypatch):
    monkeypatch.setattr(P, "build_users_snapshot", lambda: {"users": []}, raising=False)
    # build_users_snapshot 在函数内 import,改用 patch 其来源
    import chayuan.server.admin.users_analytics as ua
    monkeypatch.setattr(ua, "build_users_snapshot", lambda now=None: {"users": []})
    res = P.generate_persona_analysis(999)
    assert res["ok"] is False and res["reason"] == "user-not-found"


def test_persona_no_llm(monkeypatch):
    import chayuan.server.admin.users_analytics as ua
    monkeypatch.setattr(ua, "build_users_snapshot", lambda now=None: {"users": [{"id": 1, "username": "a"}]})
    monkeypatch.setattr(P, "pick_chat_model", lambda: None)
    res = P.generate_persona_analysis(1)
    assert res["ok"] is False and res["reason"] == "no-llm-platform"


def test_persona_ok(monkeypatch):
    import chayuan.server.admin.users_analytics as ua
    user = {"id": 1, "username": "a", "role": "user", "is_active": True, "email": "",
            "created_at": None, "last_login_at": None, "msg_count": 3, "est_tokens": 10,
            "total_chars": 15, "feedback_count": 0, "avg_feedback": None,
            "first_active": None, "last_active": None, "model_usage": {"qwen": 3},
            "tool_usage": {}, "kb_usage": {}, "chat_type_usage": {"chat": 3}, "recent_queries": []}
    monkeypatch.setattr(ua, "build_users_snapshot", lambda now=None: {"users": [user]})
    monkeypatch.setattr(P, "pick_chat_model", lambda: ("qwen", "http://x", "EMPTY"))
    monkeypatch.setattr(P, "call_llm", lambda m, b, k, p: "## 画像\n开发者")
    res = P.generate_persona_analysis(1)
    assert res["ok"] is True and res["model"] == "qwen"
    assert "画像" in res["analysis"] and "generated_at" in res


def test_build_prompt_contains_user(monkeypatch):
    p = P.build_persona_prompt({"username": "bob", "id": 7, "role": "admin", "is_active": True,
                                "model_usage": {"qwen": 2}, "recent_queries": [{"time": "2026-06-20T01:02", "chat_type": "chat", "query": "hi"}]})
    assert "bob" in p and "#7" in p and "qwen(2)" in p

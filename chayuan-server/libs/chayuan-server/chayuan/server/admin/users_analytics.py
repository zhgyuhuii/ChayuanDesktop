"""用户运营聚合(框架无关,JSON-ready)。admin REST 消费。

独立于 config_panel/users_page.py 的 NiceGUI 版(逐域完全切换:React 栈独立建,
最后整体删 NiceGUI)。聚合逻辑与 NiceGUI build_snapshot 对齐。
"""
from __future__ import annotations

import collections
import json
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from chayuan.server.db.models.message_model import MessageModel
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope

_LOOKBACK_DAYS = 400
_TOKENS_PER_CHAR = 1.0 / 1.5
_ANON_UID = 0
_ANON_LABEL = "（匿名 / legacy）"
_FEEDBACK_EDGES = [(0, 20), (20, 40), (40, 60), (60, 80), (80, 100)]


def _est_tokens(text_len: int) -> int:
    return int(text_len * _TOKENS_PER_CHAR)


def _safe_parse_intermediate_steps(raw: Any) -> List[str]:
    """从 agent meta_data.intermediate_steps 抽工具名(kwargs.tool);失败返回 []。"""
    if not raw:
        return []
    if isinstance(raw, (list, tuple)):
        data = list(raw)
    elif isinstance(raw, str):
        try:
            data = json.loads(raw)
        except Exception:
            return re.findall(r'"tool"\s*:\s*"([^"\\]+)"', raw)
    else:
        return []
    tools: List[str] = []
    if not isinstance(data, list):
        return tools
    for step in data:
        action = None
        if isinstance(step, (list, tuple)) and step:
            action = step[0]
        elif isinstance(step, dict):
            action = step
        if not isinstance(action, dict):
            continue
        kwargs = action.get("kwargs") or {}
        tool_name = kwargs.get("tool") or action.get("tool")
        if isinstance(tool_name, str) and tool_name:
            tools.append(tool_name)
    return tools


def _extract_kb_name(chat_type: str, meta: Dict[str, Any], conv_name: str = "") -> Optional[str]:
    """从 meta_data 或会话名启发式提取知识库名。"""
    if isinstance(meta, dict):
        for k in ("kb_name", "knowledge_base", "kb"):
            v = meta.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    ct = (chat_type or "").lower()
    if "kb" in ct or "knowledge" in ct:
        m = re.search(r"\[([^\]]+)\]", conv_name or "")
        if m:
            return m.group(1).strip()
        return "（未命名 KB）"
    return None


def _new_stats(info: dict) -> dict:
    return {
        **info, "msg_count": 0, "est_tokens": 0, "total_chars": 0,
        "avg_feedback": None, "feedback_count": 0,
        "first_active": None, "last_active": None,
        "model_usage": {}, "chat_type_usage": {}, "tool_usage": {}, "kb_usage": {},
        "heatmap": [[0] * 24 for _ in range(7)],
        "recent_queries": [],
    }


def build_users_snapshot(now: Optional[datetime] = None) -> dict:
    now = now or datetime.now()
    cutoff = now - timedelta(days=_LOOKBACK_DAYS)
    active_since = now - timedelta(days=7)

    global_heatmap = [[0] * 24 for _ in range(7)]
    feedback_hist = [0, 0, 0, 0, 0]
    daily_counter: Dict[str, int] = collections.defaultdict(int)
    daily_active_users: Dict[str, set] = collections.defaultdict(set)
    active_7d_users: set = set()
    total_messages = 0
    total_chars = 0
    feedback_sum = 0.0
    feedback_count = 0

    try:
        from chayuan.server.db.models.conversation_model import ConversationModel
        _has_conv = True
    except Exception:
        _has_conv = False

    with session_scope() as s:
        users = s.query(UserModel).order_by(UserModel.id).all()
        umap: Dict[int, dict] = {}
        for u in users:
            umap[int(u.id)] = _new_stats({
                "id": int(u.id), "username": u.username, "role": u.role or "user",
                "email": u.email or "", "is_active": bool(u.is_active),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            })
        total_users = len(users)

        conv_map: Dict[str, tuple] = {}
        if _has_conv:
            for c in s.query(ConversationModel.id, ConversationModel.name, ConversationModel.chat_type).all():
                conv_map[str(c.id)] = (c.name or "", c.chat_type or "")

        rows = s.query(
            MessageModel.user_id, MessageModel.chat_type, MessageModel.query,
            MessageModel.response, MessageModel.meta_data, MessageModel.feedback_score,
            MessageModel.create_time, MessageModel.conversation_id,
        ).filter(MessageModel.create_time >= cutoff).all()

        for uid_raw, chat_type, q, r_, meta, fb_raw, ctime, conv_id_raw in rows:
            uid = int(uid_raw or 0) or _ANON_UID
            chat_type = chat_type or ""
            q = q or ""
            r_ = r_ or ""
            meta = meta if isinstance(meta, dict) else {}
            fb = int(fb_raw if fb_raw is not None else -1)
            conv_id = str(conv_id_raw or "")

            st = umap.get(uid)
            if st is None:
                if uid == _ANON_UID:
                    st = umap[_ANON_UID] = _new_stats({
                        "id": _ANON_UID, "username": _ANON_LABEL, "role": "anon",
                        "email": "", "is_active": True, "created_at": None, "last_login_at": None,
                    })
                else:
                    continue
            st["msg_count"] += 1
            total_messages += 1
            length = len(q) + len(r_)
            total_chars += length
            st["total_chars"] += length
            st["est_tokens"] += _est_tokens(length)

            if ctime is not None:
                ci = ctime.isoformat()
                if st["first_active"] is None or ci < st["first_active"]:
                    st["first_active"] = ci
                if st["last_active"] is None or ci > st["last_active"]:
                    st["last_active"] = ci
                day = ctime.strftime("%m-%d")
                daily_counter[day] += 1
                if uid != _ANON_UID:
                    daily_active_users[day].add(uid)
                    if ctime >= active_since:
                        active_7d_users.add(uid)
                try:
                    global_heatmap[ctime.weekday()][ctime.hour] += 1
                    st["heatmap"][ctime.weekday()][ctime.hour] += 1
                except Exception:
                    pass

            if fb >= 0:
                feedback_sum += fb
                feedback_count += 1
                st["feedback_count"] += 1
                prev_avg = st["avg_feedback"] or 0.0
                prev_n = st["feedback_count"] - 1
                st["avg_feedback"] = (prev_avg * prev_n + fb) / st["feedback_count"]
                for i, (lo, hi) in enumerate(_FEEDBACK_EDGES):
                    if lo <= fb < (hi if hi < 100 else 101):
                        feedback_hist[i] += 1
                        break

            model_name = str(meta.get("model") or "").strip() if isinstance(meta, dict) else ""
            if model_name:
                st["model_usage"][model_name] = st["model_usage"].get(model_name, 0) + 1
            if chat_type:
                st["chat_type_usage"][chat_type] = st["chat_type_usage"].get(chat_type, 0) + 1
            for t in _safe_parse_intermediate_steps(meta.get("intermediate_steps")):
                st["tool_usage"][t] = st["tool_usage"].get(t, 0) + 1
            conv_name, conv_type = conv_map.get(conv_id, ("", ""))
            kb = _extract_kb_name(chat_type or conv_type, meta, conv_name)
            if kb:
                st["kb_usage"][kb] = st["kb_usage"].get(kb, 0) + 1
            if len(st["recent_queries"]) < 10 and q:
                st["recent_queries"].append({
                    "time": ctime.isoformat() if ctime else now.isoformat(),
                    "chat_type": chat_type, "query": q[:200], "model": model_name,
                })

    # top-N
    mc, tc, kc, cc = (collections.Counter() for _ in range(4))
    for st in umap.values():
        mc.update(st["model_usage"]); tc.update(st["tool_usage"])
        kc.update(st["kb_usage"]); cc.update(st["chat_type_usage"])
    def _topn(counter):
        return [{"name": n, "count": v} for n, v in counter.most_common(10)]
    top_model = _topn(mc)

    # user×model matrix(Top10 用户 × Top10 模型)
    top_users = sorted([st for st in umap.values() if st["msg_count"] > 0],
                       key=lambda x: x["est_tokens"], reverse=True)[:10]
    top_models = [d["name"] for d in top_model[:10]]
    matrix = []
    for st in top_users:
        for m in top_models:
            v = st["model_usage"].get(m, 0)
            if v:
                matrix.append({"user": st["username"], "model": m, "count": v})

    users_list = sorted(umap.values(), key=lambda x: (-x["est_tokens"], x["id"]))
    labels_30 = [(now - timedelta(days=i)).strftime("%m-%d") for i in range(29, -1, -1)]
    seven_iso = active_since.isoformat()
    return {
        "users": users_list,
        "daily_msg": [{"date": d, "count": daily_counter.get(d, 0)} for d in labels_30],
        "daily_active": [{"date": d, "active_users": len(daily_active_users.get(d, set()))} for d in labels_30],
        "total_users": total_users,
        "active_7d": len(active_7d_users),
        "total_messages": total_messages,
        "total_tokens": _est_tokens(total_chars),
        "total_feedback": feedback_count,
        "avg_feedback": (feedback_sum / feedback_count) if feedback_count else 0.0,
        "top_model": top_model,
        "top_tool": _topn(tc),
        "top_kb": _topn(kc),
        "top_chat_type": _topn(cc),
        "user_model_matrix": matrix,
        "global_heatmap": global_heatmap,
        "global_heatmap_max": max((v for row in global_heatmap for v in row), default=0),
        "feedback_hist": feedback_hist,
        "generated_at": now.timestamp(),
    }

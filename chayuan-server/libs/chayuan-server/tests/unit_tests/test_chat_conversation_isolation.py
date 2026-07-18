from __future__ import annotations
import pytest
pytest.importorskip("sqlalchemy")  # 本沙箱无 sqlalchemy -> skip;真机跑

from chayuan.server.db.session import session_scope
from chayuan.server.db.models.conversation_model import ConversationModel
from chayuan.server.db.repository.conversation_repository import (
    add_conversation_to_db, get_conversation_by_id, list_conversations_for_user,
)


def _ids(rows):
    return {(r["id"] if isinstance(r, dict) else r.id) for r in rows}


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(ConversationModel).delete()
    _purge(); yield; _purge()


def test_list_isolates_by_user():
    add_conversation_to_db(chat_type="agent_chat", name="a", conversation_id="ca", user_id=1)
    add_conversation_to_db(chat_type="agent_chat", name="b", conversation_id="cb", user_id=2)
    assert _ids(list_conversations_for_user(user_id=1)) == {"ca"}
    assert _ids(list_conversations_for_user(user_id=2)) == {"cb"}


def test_admin_none_sees_all():
    add_conversation_to_db(chat_type="agent_chat", name="a", conversation_id="ca", user_id=1)
    add_conversation_to_db(chat_type="agent_chat", name="b", conversation_id="cb", user_id=2)
    assert {"ca", "cb"}.issubset(_ids(list_conversations_for_user(user_id=None)))


def test_get_conversation_by_id_detached_scalar_access():
    """回归(2026-07-18 DetachedInstanceError / ChatGraph 500)。

    get_conversation_by_id 走 @with_session:commit 后 close，把 ORM 对象返回上层。
    SessionLocal 若用默认 expire_on_commit=True，commit 会 expire 全部属性，上层
    访问 conv.user_id(会话按用户隔离的归属校验)触发对 expired 标量的 refresh，
    但 session 已关 → "Instance ... is not bound to a Session; attribute refresh
    operation cannot proceed"。修复=SessionLocal expire_on_commit=False。
    本测试确保 session 关闭后读标量不再抛错。
    """
    add_conversation_to_db(
        chat_type="agent_chat", name="x", conversation_id="cx", user_id=42,
    )
    conv = get_conversation_by_id(conversation_id="cx")  # 返回后 session 已 commit+close
    assert conv is not None
    # 关键断言:detached 对象读标量不得抛 DetachedInstanceError
    assert conv.user_id == 42
    assert conv.name == "x"
    assert conv.chat_type == "agent_chat"
    assert conv.id == "cx"

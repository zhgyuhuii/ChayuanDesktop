from __future__ import annotations
import pytest
pytest.importorskip("sqlalchemy")  # 本沙箱无 sqlalchemy -> skip;真机跑

from chayuan.server.db.session import session_scope
from chayuan.server.db.models.conversation_model import ConversationModel
from chayuan.server.db.repository.conversation_repository import (
    add_conversation_to_db, list_conversations_for_user,
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

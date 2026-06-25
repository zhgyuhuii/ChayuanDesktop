import pytest

pytest.importorskip("sqlalchemy")  # 需 DB 栈;沙箱缺依赖则 skip,真机才跑

from chayuan.server.db.repository import user_tool_pref_repository as repo


def test_set_and_list_disabled_roundtrip():
    uid = 999001
    # 清干净
    repo.set_tool_disabled(uid, "url_reader", disabled=False)
    assert "url_reader" not in repo.list_disabled(uid)
    # 关闭 → 出现在集合
    repo.set_tool_disabled(uid, "url_reader", disabled=True)
    assert "url_reader" in repo.list_disabled(uid)
    # 幂等再关一次仍只一条
    repo.set_tool_disabled(uid, "url_reader", disabled=True)
    assert "url_reader" in repo.list_disabled(uid)
    # 重新启用 → 移除
    repo.set_tool_disabled(uid, "url_reader", disabled=False)
    assert "url_reader" not in repo.list_disabled(uid)


def test_list_disabled_none_user_is_empty():
    assert repo.list_disabled(None) == set()

"""按用户的工具关闭记录仓库。一行 = 用户关闭了某工具(opt-out)。"""
from __future__ import annotations

import logging
from typing import Optional, Set

from chayuan.server.db.models.user_tool_pref_model import UserToolPrefModel
from chayuan.server.db.session import session_scope

logger = logging.getLogger("chayuan.user_tool_pref_repo")


def list_disabled(user_id: Optional[int]) -> Set[str]:
    """该用户关闭的工具名集合;user_id 为空 → 空集。"""
    if user_id is None:
        return set()
    try:
        with session_scope() as s:
            rows = (
                s.query(UserToolPrefModel.tool_name)
                .filter(UserToolPrefModel.user_id == int(user_id))
                .all()
            )
            return {r[0] for r in rows}
    except Exception as e:  # noqa: BLE001 — 查询失败按"无关闭"处理,不挡功能
        logger.warning("[user_tool_pref] list_disabled 失败: %r", e)
        return set()


def set_tool_disabled(user_id: Optional[int], tool_name: str, disabled: bool) -> None:
    """disabled=True 插入(幂等);False 删除。user_id/tool_name 为空直接返回。"""
    if user_id is None or not tool_name:
        return
    with session_scope() as s:
        q = s.query(UserToolPrefModel).filter(
            UserToolPrefModel.user_id == int(user_id),
            UserToolPrefModel.tool_name == tool_name,
        )
        row = q.first()
        if disabled and row is None:
            s.add(UserToolPrefModel(user_id=int(user_id), tool_name=tool_name))
        elif not disabled and row is not None:
            q.delete()

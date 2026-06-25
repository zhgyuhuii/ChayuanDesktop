"""按用户的工具有效集计算(opt-out:有效 = 全局启用 − 用户关闭)。

纯函数 effective_enabled_names 不依赖 DB/全局配置,可单测;global_enabled_tool_names /
effective_enabled_tools 在运行时把全局配置 + 用户关闭集接起来(懒导入,避免循环依赖)。
"""
from __future__ import annotations

from typing import Optional, Set


def effective_enabled_names(global_enabled: Set[str], disabled: Optional[Set[str]]) -> Set[str]:
    """有效启用工具名 = 全局启用 − 用户关闭(关闭集里不在全局的项天然被忽略)。"""
    return set(global_enabled or set()) - set(disabled or set())


def global_enabled_tool_names() -> Set[str]:
    """全局启用(tool_settings.yaml use:true)的运行时工具名集合;与 list_tools(enabled) 同源。"""
    from chayuan.server.utils import get_tool, get_tool_config
    from chayuan.server.api_server.tool_routes import _effective_config_key  # 懒导入避免环

    out: Set[str] = set()
    for t in (get_tool() or {}).values():
        cfg = get_tool_config(_effective_config_key(t.name)) or {}
        if bool(cfg.get("use", False)):
            out.add(t.name)
    return out


def effective_enabled_tools(user_id: Optional[int]) -> Set[str]:
    """该用户在对话里实际可用的工具名。user_id None(guest/单机)→ 全部全局启用(不过滤)。"""
    g = global_enabled_tool_names()
    if user_id is None:
        return g
    try:
        from chayuan.server.db.repository import user_tool_pref_repository as repo
        disabled = repo.list_disabled(int(user_id))
    except Exception:  # noqa: BLE001 — 无 DB / 异常一律不过滤,不挡对话
        disabled = set()
    return effective_enabled_names(g, disabled)

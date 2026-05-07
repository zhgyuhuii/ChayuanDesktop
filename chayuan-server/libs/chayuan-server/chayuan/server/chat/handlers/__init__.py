"""模式处理器（ModeHandler）插件包。

每个 ChatMode 在这里有一个独立模块（``llm.py`` / ``agent.py`` / ``kb.py`` / ...），
模块顶层调用 :func:`register_handler` 注册自己。``chat.graph.nodes`` 的 retrieve
节点不再写一长串 if/elif，而是 :func:`get_handler(mode).retrieve(state)`。

新增模式 = 在这里加一个文件 + 一个装饰器，0 改动其它文件。

加载策略：
- 包导入时 eager-load 所有内置 handler 模块（执行各自的 ``register_handler`` 调用）
- handler 失败注册（依赖缺失等）只打 debug，不影响其它模式可用性
"""
from __future__ import annotations

import importlib
import logging

from chayuan.server.chat.handlers.base import (
    BaseModeHandler,
    HandlerNotFound,
    get_handler,
    list_handlers,
    register_handler,
)

logger = logging.getLogger("chayuan.chat.handlers")


_BUILTIN_MODULES = (
    "chayuan.server.chat.handlers.llm",
    "chayuan.server.chat.handlers.agent",
    "chayuan.server.chat.handlers.kb",
    "chayuan.server.chat.handlers.file",
    "chayuan.server.chat.handlers.search_engine",
    "chayuan.server.chat.handlers.multi_source",
    "chayuan.server.chat.handlers.vision",
    "chayuan.server.chat.handlers.supervisor",
)


def _load_builtins() -> None:
    """import 所有内置 handler 模块，触发其 ``register_handler``。"""
    for mod in _BUILTIN_MODULES:
        try:
            importlib.import_module(mod)
        except Exception as e:  # noqa: BLE001
            logger.debug("handler module %s 注册失败：%r", mod, e)


_load_builtins()


__all__ = [
    "BaseModeHandler",
    "HandlerNotFound",
    "get_handler",
    "list_handlers",
    "register_handler",
]

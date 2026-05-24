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
    """import 所有内置 handler 模块，触发其 ``register_handler``。

    历史教训(2026-05-24):import 失败原来打 logger.debug,debug 级别默认
    不输出,导致 frozen 模式下 kb handler 静默注册失败 → get_handler('kb')
    抛 HandlerNotFound → chat retrieve 返空 chunks → 用户挂载 KB 后 0 命中。
    排查一整天才定位。升级到 warning + 输出完整 traceback。

    ⚠ 同时打 print() 到 stdout(不走 logging 配置,绝不被任何 level 过滤)
    —— 装机版排查时这条 marker 是判断"修法有没有真进 frozen"的依据。
    """
    import sys, traceback as _tb
    for mod in _BUILTIN_MODULES:
        sys.stdout.write(f"[_load_builtins] try   {mod}\n")
        sys.stdout.flush()
        try:
            importlib.import_module(mod)
            sys.stdout.write(f"[_load_builtins] OK    {mod}\n")
            sys.stdout.flush()
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(
                f"[_load_builtins] FAIL  {mod}: {type(e).__name__}: {e}\n"
            )
            _tb.print_exc(file=sys.stdout)
            sys.stdout.flush()
            logger.warning(
                "[handlers] %s 注册失败 (%s: %s) -- 这个 mode 的对话会走"
                "空检索 fallback,问题大概率是 frozen 打包遗漏依赖。",
                mod, type(e).__name__, e, exc_info=True,
            )


_load_builtins()


__all__ = [
    "BaseModeHandler",
    "HandlerNotFound",
    "get_handler",
    "list_handlers",
    "register_handler",
]

"""``python -m chayuan`` / PyInstaller frozen 入口。

Phase 2 引入:PyInstaller spec 优先把这里作为入口(比 ``cli.py`` 干净一点 ──
``cli.py`` 顶部有重依赖 + brandlock check,作为 frozen entry 静态分析时会拖更多
不必要的子模块进 graph)。``cli:main`` 仍是 ``poetry run chayuan`` 命令的真源。
"""
from __future__ import annotations

import sys


def _force_utf8_stdio() -> None:
    """单机版 / frozen exe 在 Windows OEM(GBK)console 里默认会把 UTF-8 输出
    渲染成乱码。这里在 cli 解析任何参数 / 加载任何模块前,先把 sys.stdout /
    sys.stderr 切到 UTF-8(errors='replace' 保底,免得偶发 surrogate 让进程崩)。

    Python 3.7+ 的 ``TextIOWrapper.reconfigure`` 是原地重配,
    不会把已 attach 的下游(loguru / logging handlers)断链。
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        # detached / closed streams(daemon 模式下偶发)不动
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


_force_utf8_stdio()


from chayuan.cli import main


if __name__ == "__main__":
    main()

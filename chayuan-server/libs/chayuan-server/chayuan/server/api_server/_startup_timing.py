"""启动分段计时 —— stdout 直写(绕过 logging 配置,frozen sidecar 也可见)+ logger。

用法:
    with phase("nltk-bootstrap"):
        ensure_nltk_data()
→ 启动日志出现:[startup-timing] nltk-bootstrap took 1234 ms
"""
from __future__ import annotations

import logging
import sys
import time
from contextlib import contextmanager

_log = logging.getLogger("chayuan.startup.timing")


def _format_ms(seconds: float) -> str:
    return f"{seconds * 1000:.0f} ms"


@contextmanager
def phase(name: str):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        msg = f"[startup-timing] {name} took {_format_ms(time.perf_counter() - t0)}"
        try:
            sys.stdout.write(msg + "\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass
        try:
            _log.info(msg)
        except Exception:  # noqa: BLE001
            pass

"""本地 runtime 诊断模块。

入口 ``run_all_checks()`` 跑所有 check 返回 ``DiagnoseReport``;
单个 check 也可以单独 import (例:``from .checks import check_port``)。
"""
from __future__ import annotations

from .types import DiagnoseCheck, DiagnoseReport, Severity

__all__ = ["DiagnoseCheck", "DiagnoseReport", "Severity"]

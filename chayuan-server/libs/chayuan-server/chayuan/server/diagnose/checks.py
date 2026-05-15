"""所有 diagnose check 函数。每个函数纯函数化,无 IO 副作用 (除了读盘 / 网络)。

约定:任何函数都不允许抛异常,内部用 try/except 包好;失败时返回
severity=fail + detail 描述。
"""
from __future__ import annotations

from chayuan.server.diagnose.types import DiagnoseCheck


def check_sidecar_healthz() -> DiagnoseCheck:
    """sidecar 进程跑起来就视为 ok (路由调用本函数 = 路由可达 = healthz 一定通)。

    单独保留这个 check 是给报告里留个明确正信号:用户看到「sidecar.healthz: ✓」
    就知道至少 HTTP 层是通的,后面其它 check 失败可以锁定到具体子系统。
    """
    return DiagnoseCheck(
        name="sidecar.healthz",
        ok=True,
        severity="ok",
        detail="sidecar HTTP 层就绪 (routing layer responsive)",
    )

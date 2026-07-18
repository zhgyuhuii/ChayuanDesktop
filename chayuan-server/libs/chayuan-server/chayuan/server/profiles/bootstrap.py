"""Profile 选择与统一入口(``apply_profile``)。

读 ``CHAYUAN_PROFILE`` 环境变量,把对应 profile 的 ``apply_*`` 函数派发出去。
``startup.main`` 在 mp.freeze_support() 之后调用一次,所有 ``Settings.*`` 的
重写在这里完成,业务代码照常读 Settings 不感知 profile 切换。
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger("chayuan.profiles")


# 已支持的 profile 名:env 字符串 → 内部 canonical 形态。
_KNOWN_PROFILES = {
    "single-machine": "single-machine",
    "single_machine": "single-machine",
    "singlemachine": "single-machine",
    "desktop": "single-machine",  # 别名
}


def _in_container() -> bool:
    """是否在容器(镜像)里运行。

    真源:镜像 ``docker/Dockerfile`` 里 ENV ``CHAYUAN_IN_CONTAINER=1``;另兜底
    探测 ``/.dockerenv``(几乎所有 docker 运行时都会建)。
    """
    v = (os.environ.get("CHAYUAN_IN_CONTAINER") or "").strip().lower()
    if v and v not in ("0", "false", "no"):
        return True
    try:
        return os.path.exists("/.dockerenv")
    except Exception:  # noqa: BLE001
        return False


def active_profile() -> Optional[str]:
    """读 ``CHAYUAN_PROFILE`` 并归一化;未设 / 不识别返回 None(SaaS / 服务版默认形态)。

    **容器铁律**:只要在容器里启动就一定是服务版 —— 单机版只存在于桌面 App
    (PyInstaller,不走镜像)。因此即使有人在容器里误设/继承了旧镜像的
    ``CHAYUAN_PROFILE=single-machine``,也强制按服务版(返回 None)处理,避免
    容器被当单机(sqlite / 匿名 / 「单机版无需部署授权」)。
    """
    raw = (os.environ.get("CHAYUAN_PROFILE") or "").strip().lower()
    if not raw:
        return None
    prof = _KNOWN_PROFILES.get(raw)
    if prof == "single-machine" and _in_container():
        logger.warning(
            "[profiles] 容器内检测到 CHAYUAN_PROFILE=single-machine —— 容器一律按"
            "服务版运行(单机版只在桌面 App),已忽略该 profile。",
        )
        return None
    return prof


def is_single_machine() -> bool:
    """单机 profile 处于激活状态时为 True。"""
    return active_profile() == "single-machine"


def apply_profile() -> Optional[str]:
    """根据 ``CHAYUAN_PROFILE`` 重写全局 ``Settings``;返回应用了的 profile 名。

    在 ``chayuan/startup.py:main`` 早期调用一次。幂等:重复调不会引入额外副作用。
    未识别 / 未设的 profile 直接返回 None,等价于走原 SaaS 路径(零修改)。
    """
    name = active_profile()
    if name is None:
        return None

    if name == "single-machine":
        from chayuan.server.profiles.single_machine import apply_single_machine

        apply_single_machine()
        logger.info("[profile] applied: single-machine")
        return "single-machine"

    logger.warning("[profile] unknown profile %r; skip", name)
    return None

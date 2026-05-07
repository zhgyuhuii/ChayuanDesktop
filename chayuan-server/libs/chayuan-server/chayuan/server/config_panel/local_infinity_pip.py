"""93-1:本地 pip 安装的 Infinity 探活 helper。

业务场景
========
用户 ``pip install infinity-emb[all]`` 后,本机就有一个 ``infinity_emb`` 二进制,
可以跑 ``infinity_emb v2 --model-id jinaai/jina-clip-v1`` 起一个 HTTP 服务。

这种部署方式比 docker 更轻(不用 Docker Desktop / GPU 直通配置),
适合开发者本机 / 单人办公机。本模块负责:

1. 检测 ``infinity_emb`` 二进制是否在 PATH(``shutil.which``)
2. 同时尝试 ``import infinity_emb``,验证包能加载(避免命名冲突)
3. 端口 ping(本地默认 7997 或用户配的)

返回 dataclass 给上层(probe / UI)用。
"""
from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("chayuan.config_panel.local_infinity_pip")


# 默认本地 pip Infinity 监听端口(infinity_emb v2 默认 7997)。
# 用户可通过 CHAYUAN_LOCAL_INFINITY_PORT 环境变量覆盖。
_DEFAULT_LOCAL_PORT = 7997


def _local_infinity_url() -> str:
    """返回本地 pip Infinity 默认 URL(不拼 health 路径)。"""
    port = os.environ.get("CHAYUAN_LOCAL_INFINITY_PORT", "").strip()
    try:
        port_n = int(port) if port else _DEFAULT_LOCAL_PORT
    except ValueError:
        port_n = _DEFAULT_LOCAL_PORT
    return f"http://127.0.0.1:{port_n}"


@dataclass(frozen=True)
class LocalInfinityStatus:
    """本地 pip Infinity 状态快照。"""

    binary_path: Optional[str]    # infinity_emb 二进制绝对路径,缺则 None
    package_importable: bool      # import infinity_emb 是否成功
    port_open: bool               # 默认端口 HTTP ping 是否通(说明 server 在跑)
    base_url: str                 # 探活时使用的 URL

    @property
    def installed(self) -> bool:
        """二进制 OR 包能 import → 视为已装。"""
        return bool(self.binary_path) or self.package_importable

    @property
    def running(self) -> bool:
        """已装 + 端口通 → 进程在跑。"""
        return self.installed and self.port_open

    def to_dict(self) -> dict:
        return {
            "binary_path": self.binary_path,
            "package_importable": self.package_importable,
            "port_open": self.port_open,
            "base_url": self.base_url,
            "installed": self.installed,
            "running": self.running,
        }


def _check_binary() -> Optional[str]:
    """``shutil.which("infinity_emb")``,返绝对路径或 None。"""
    return shutil.which("infinity_emb")


def _check_package_importable() -> bool:
    """``import infinity_emb`` 是否成功。

    用 importlib.util.find_spec 探,**不实际加载**模块(避免 GPU init 等副作用)。
    """
    try:
        import importlib.util
        spec = importlib.util.find_spec("infinity_emb")
        return spec is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False
    except Exception as e:  # noqa: BLE001 — find_spec 在某些破损环境下抛
        logger.debug("[local_infinity_pip] find_spec failed: %r", e)
        return False


def _check_port_open(url: str, timeout: float = 0.5) -> bool:
    """对 ``url + /health`` 做一次 GET,2xx/4xx 都算 server 在跑。"""
    try:
        import httpx  # type: ignore
    except ImportError:
        return False
    full = url.rstrip("/") + "/health"
    try:
        r = httpx.get(full, timeout=timeout)
        return r.status_code < 500
    except Exception:  # noqa: BLE001
        return False


def get_local_infinity_status(*, probe_port: bool = True) -> LocalInfinityStatus:
    """93-1:返回本地 pip Infinity 当前状态。

    Args:
        probe_port: 是否做 HTTP 探活。False → 只查二进制 / 包(快,< 1ms)。
    """
    binary = _check_binary()
    pkg = _check_package_importable()
    base = _local_infinity_url()
    if probe_port and (binary or pkg):
        port_ok = _check_port_open(base)
    else:
        port_ok = False
    return LocalInfinityStatus(
        binary_path=binary,
        package_importable=pkg,
        port_open=port_ok,
        base_url=base,
    )


def is_local_infinity_pip_available() -> bool:
    """93-1:简化布尔接口 —— 二进制或包可用即返 True(不检测端口)。"""
    return get_local_infinity_status(probe_port=False).installed


def is_local_infinity_running() -> bool:
    """93-1:本地 pip + 端口通 → 进程已起。"""
    return get_local_infinity_status(probe_port=True).running


def start_local_infinity_subprocess(
    model_id: str, *, port: Optional[int] = None,
) -> dict:
    """93-4:后台启动 ``infinity_emb v2 --model-id <m>`` 子进程。

    返回 ``{"ok": bool, "pid": int|None, "msg": str, "url": str}``。
    用 ``subprocess.Popen`` + ``DEVNULL`` 避免 zombie / 阻塞;不持有 handle,
    后续靠端口探活判定是否在跑(简化版,不做 process tree 管理)。

    幂等保护:如果端口已通,直接返 ok=true 不重复起。
    """
    if not model_id or not model_id.strip():
        return {"ok": False, "pid": None, "msg": "model_id 必填", "url": ""}
    binary = _check_binary()
    pkg = _check_package_importable()
    if not (binary or pkg):
        return {
            "ok": False, "pid": None,
            "msg": "本地未安装 infinity_emb;请先 pip install infinity-emb[all]",
            "url": "",
        }
    target_port = port if port else int(
        os.environ.get("CHAYUAN_LOCAL_INFINITY_PORT", "").strip() or _DEFAULT_LOCAL_PORT
    )
    base = f"http://127.0.0.1:{target_port}"
    # 端口已通 → 不重复起
    if _check_port_open(base):
        return {"ok": True, "pid": None,
                "msg": "端口已通,无需重复启动", "url": base}
    import subprocess
    import sys
    cmd: list = []
    if binary:
        cmd = [binary, "v2", "--model-id", model_id, "--port", str(target_port)]
    else:
        # 包能 import 但 binary 找不到 → 用 python -m
        cmd = [sys.executable, "-m", "infinity_emb", "v2",
               "--model-id", model_id, "--port", str(target_port)]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"ok": True, "pid": proc.pid,
                "msg": f"已发起启动(模型加载需若干秒);命令: {' '.join(cmd)}",
                "url": base}
    except Exception as e:  # noqa: BLE001
        logger.exception("[local_infinity_pip] subprocess start failed")
        return {"ok": False, "pid": None,
                "msg": f"启动失败: {type(e).__name__}: {e}",
                "url": base}


__all__ = [
    "LocalInfinityStatus",
    "get_local_infinity_status",
    "is_local_infinity_pip_available",
    "is_local_infinity_running",
    "start_local_infinity_subprocess",
]

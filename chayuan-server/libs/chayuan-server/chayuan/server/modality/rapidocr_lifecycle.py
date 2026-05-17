"""RapidOCR sidecar daemon 生命周期管理。

为什么需要这个模块
==================
``rapidocr_server.py`` 是一个独立的 Python 进程(``uvicorn`` 起的 ``/v1/ocr``
HTTP 服务,端口 18380),**不**走 ``LocalRuntimeRegistry`` 管的 5 个
capability(那个管 llama-server / whisper-server / Infinity 的生命周期)。

之前它只有两种启动方式:
  1) 用户在 UI 上点「设置 → 运行时框架 → RapidOCR → 启动」
  2) 用户在命令行手动跑 ``python -m chayuan.server.modality.rapidocr_server``

两种都要用户主动操作,结果用户上传图片就拿 503 "OCR sidecar not ready"。
本模块封装 ``start / stop / status``,给:
  - ``server_app.py`` 的 startup hook(进程起来时自动拉起)
  - ``modality_routes.py`` 的 ``/sidecar/ocr/*`` 路由(给前端 UI 启停)

端口固定 18380,跟 ``ocr_client._OCR_PORTS`` / ``install_task_manager``
recipe 的硬编码对齐。
"""
from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("chayuan.modality.rapidocr_lifecycle")

# 跟 install_task_manager._START_RECIPES["rapidocr"] / ocr_client._OCR_PORTS 对齐
RAPIDOCR_PORT = 18380
RAPIDOCR_HOST = "127.0.0.1"
# 启动后等多久 TCP 探测到 ready;超过这个时间认作启动失败(典型 cold start 2-4s)
_READY_TIMEOUT_SEC = 10.0
_READY_PROBE_INTERVAL_SEC = 0.3


def _log_path() -> str:
    """跟 install_task_manager._bg_log_path('rapidocr') 同一路径,方便用户排查。"""
    if os.name == "nt":
        base = (
            os.environ.get("TEMP")
            or os.environ.get("TMP")
            or "C:\\Windows\\Temp"
        )
        return os.path.join(base, "chayuan_rapidocr.log")
    return "/tmp/chayuan_rapidocr.log"


def _port_listening(port: int = RAPIDOCR_PORT, host: str = RAPIDOCR_HOST,
                       timeout: float = 0.3) -> bool:
    """TCP 探测 host:port 在不在监听。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            return s.connect_ex((host, int(port))) == 0
    except OSError:
        return False


def _registered_child() -> Optional[Dict[str, Any]]:
    """从 runtime meta 读 "ocr" role 的注册记录;不存在返 None。"""
    try:
        from chayuan.server.config_panel.restart import list_children
        return list_children().get("ocr")
    except Exception:  # noqa: BLE001
        return None


def _is_pid_alive(pid: int) -> bool:
    try:
        from chayuan.server.shared.process_utils import is_pid_alive
        return bool(is_pid_alive(pid))
    except Exception:  # noqa: BLE001
        return False


def ocr_sidecar_status() -> Dict[str, Any]:
    """看 RapidOCR sidecar 当前状态。

    判断顺序:
      1) 18380 端口在监听 → ``"ready"``
      2) 端口没听 + meta 里有 "ocr" 注册 + pid 还活 → ``"starting"``(在拉起 / 异常)
      3) 都没 → ``"stopped"``

    返回字段:
      - ``state``      : ready / starting / stopped
      - ``pid``        : meta 里登记的 pid(可能为 None)
      - ``port``       : 18380
      - ``log_path``   : 后台日志路径,UI 给用户复制粘贴用
      - ``listening``  : bool,真实 TCP probe 结果
    """
    listening = _port_listening()
    meta = _registered_child() or {}
    pid = int(meta.get("pid") or 0) or None

    if listening:
        state = "ready"
    elif pid and _is_pid_alive(pid):
        state = "starting"
    else:
        state = "stopped"

    return {
        "state": state,
        "pid": pid,
        "port": RAPIDOCR_PORT,
        "log_path": _log_path(),
        "listening": listening,
    }


def _wait_until_ready(timeout: float = _READY_TIMEOUT_SEC) -> bool:
    """轮询 18380 直到 ready 或超时。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _port_listening():
            return True
        time.sleep(_READY_PROBE_INTERVAL_SEC)
    return False


def start_ocr_sidecar() -> Dict[str, Any]:
    """spawn RapidOCR daemon(若未在跑),返 ocr_sidecar_status()。

    幂等:已 ready 直接返;有 stale 注册但端口没听 → unregister 再起;
    spawn 时把 stdout/stderr 重定向到 ``_log_path()`` 方便事后排查。
    """
    # 已经在跑 → 直接返
    if _port_listening():
        logger.info("[ocr-sidecar] 已在 %d 监听,无需重启", RAPIDOCR_PORT)
        return ocr_sidecar_status()

    # 清掉 stale 注册(meta 里有 ocr 但端口没听,通常是上次崩了或被外部杀掉)
    stale = _registered_child()
    if stale:
        stale_pid = int(stale.get("pid") or 0)
        if stale_pid and _is_pid_alive(stale_pid):
            # 进程还在但端口不通 — 可能正在启动中,等一会
            logger.info(
                "[ocr-sidecar] 已注册 pid=%d 但 %d 未监听,等待 ready",
                stale_pid, RAPIDOCR_PORT,
            )
            if _wait_until_ready(timeout=3.0):
                return ocr_sidecar_status()
        # 真的不行了 — 清理注册
        try:
            from chayuan.server.config_panel.restart import unregister_child
            unregister_child("ocr")
        except Exception:  # noqa: BLE001
            pass

    # spawn rapidocr_server.py 完全 detach,日志重定向到 _log_path
    log_path = _log_path()
    try:
        # 确保 log 文件能写(目录存在)
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
    except OSError:  # noqa: BLE001
        pass

    from chayuan.server.shared.process_utils import detached_popen_kwargs
    cmd = [
        sys.executable, "-m", "chayuan.server.modality.rapidocr_server",
        "--host", RAPIDOCR_HOST, "--port", str(RAPIDOCR_PORT),
    ]
    try:
        log_fp = open(log_path, "ab")  # noqa: SIM115 — 故意保留,Popen 持有 fd
    except OSError as e:
        logger.warning("[ocr-sidecar] 无法打开日志 %s: %r;改用 DEVNULL", log_path, e)
        log_fp = subprocess.DEVNULL  # type: ignore[assignment]

    try:
        kwargs: Dict[str, Any] = {
            "stdin": subprocess.DEVNULL,
            "stdout": log_fp,
            "stderr": subprocess.STDOUT,
            **detached_popen_kwargs(),
        }
        proc = subprocess.Popen(cmd, **kwargs)
    except Exception as e:  # noqa: BLE001
        logger.exception("[ocr-sidecar] spawn 失败: %r", e)
        return {
            "state": "failed",
            "pid": None,
            "port": RAPIDOCR_PORT,
            "log_path": log_path,
            "listening": False,
            "error": f"{type(e).__name__}: {e}",
        }
    finally:
        # log_fp 已交给子进程持有,父进程的 fd 可以关
        if hasattr(log_fp, "close") and log_fp is not subprocess.DEVNULL:
            try:
                log_fp.close()
            except OSError:
                pass

    logger.info(
        "[ocr-sidecar] 已 spawn rapidocr_server pid=%d port=%d log=%s",
        proc.pid, RAPIDOCR_PORT, log_path,
    )

    # 登记到 runtime meta,供 stop / 重启用
    try:
        from chayuan.server.config_panel.restart import register_child
        register_child("ocr", int(proc.pid), port=RAPIDOCR_PORT, name="rapidocr")
    except Exception as e:  # noqa: BLE001
        logger.warning("[ocr-sidecar] register_child 失败(可忽略): %r", e)

    # 等 ready;超时也不报错,前端会看到 starting 状态
    if not _wait_until_ready():
        logger.warning(
            "[ocr-sidecar] %ds 内未 ready;子进程仍在跑,看 %s 排查",
            int(_READY_TIMEOUT_SEC), log_path,
        )

    return ocr_sidecar_status()


def stop_ocr_sidecar() -> Dict[str, Any]:
    """停 RapidOCR daemon。返 stop 之前的 pid + 当前 status。"""
    meta = _registered_child() or {}
    pid = int(meta.get("pid") or 0) or None
    stopped = False
    detail = ""

    if pid and _is_pid_alive(pid):
        try:
            from chayuan.server.shared.process_utils import terminate_pid
            stopped, detail = terminate_pid(pid, force=False, term_timeout=3.0)
        except Exception as e:  # noqa: BLE001
            logger.exception("[ocr-sidecar] terminate_pid 失败: %r", e)
            detail = f"{type(e).__name__}: {e}"
    else:
        detail = "no registered pid or already dead"

    try:
        from chayuan.server.config_panel.restart import unregister_child
        unregister_child("ocr")
    except Exception:  # noqa: BLE001
        pass

    # 等端口释放
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        if not _port_listening():
            break
        time.sleep(0.2)

    return {
        **ocr_sidecar_status(),
        "stopped_pid": pid,
        "stopped": stopped,
        "detail": detail,
    }

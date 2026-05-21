"""4 个 SidecarRuntimeManager 实例的协调器。

捷径(typical use):
    reg = get_registry()
    chat_status = reg.get("chat").status
    await reg.get("embedding").start()
    await reg.stop_all()  # lifespan shutdown

设计:跟 SidecarRuntimeManager 解耦 — manager 仍是单进程的所有者,
registry 只是 4 个 manager 的 lookup;不在 registry 内做并发协调
(每个 capability 独立 start/stop,前端按需触发)。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict, Optional

from chayuan.server.model_registry.local_runtime import SidecarRuntimeManager, RuntimeStatus


logger = logging.getLogger("chayuan.model_registry.local_runtime_registry")


# Plan 3D: cap → engine 映射
_CAP_ENGINE: Dict[str, str] = {
    "chat": "llama",
    "embedding": "llama",
    "rerank": "llama",
    "asr": "whisper",
    "image-embedding": "infinity",
}


# ──────────────────────────────────────────────────────────────────
# 启动前清理上一次遗留的孤儿 sidecar 进程
# ──────────────────────────────────────────────────────────────────
# llama-server / whisper-server 按进程名认;image-embedding / OCR 是 python
# 子进程,按命令行里的模块路径认。
_SIDECAR_NAME_PREFIXES = ("llama-server", "whisper-server")
_SIDECAR_CMDLINE_MARKERS = (
    "image_source.infinity_server",
    "modality.rapidocr_server",
)


def reap_orphan_sidecars() -> int:
    """启动时清理上一次运行遗留的孤儿 sidecar 进程,返回杀掉的进程数。

    单机版只该有一个 chayuan 实例。进程被强杀 / dev 模式热重启时,上次 spawn
    的 llama-server / whisper-server / infinity_server / rapidocr_server 不会被
    优雅回收 → 孤儿进程堆积、吃内存、抢端口,新实例的 sidecar 反而起不来。

    必须在 server 启动、spawn 任何新 sidecar **之前**调用一次:此刻还在跑的
    这些进程必然是上一次的遗留。按进程名 / 命令行精确匹配,只杀本应用的
    sidecar,不误伤用户其它进程。psutil 不可用 / 出错时静默返回 0,不阻塞启动。
    """
    try:
        import psutil
    except Exception:  # noqa: BLE001 — psutil 缺失不阻塞启动
        return 0

    me = os.getpid()
    victims: list = []
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            pid = proc.info.get("pid")
            if pid is None or pid == me:
                continue
            name = (proc.info.get("name") or "").lower()
            hit = any(name.startswith(p) for p in _SIDECAR_NAME_PREFIXES)
            if not hit:
                cmd = " ".join(proc.info.get("cmdline") or [])
                hit = any(m in cmd for m in _SIDECAR_CMDLINE_MARKERS)
            if hit:
                victims.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        except Exception:  # noqa: BLE001
            continue

    if not victims:
        return 0

    for p in victims:
        try:
            p.terminate()
        except Exception:  # noqa: BLE001
            pass
    # 给优雅退出 2s,没退的强杀
    try:
        _gone, alive = psutil.wait_procs(victims, timeout=2.0)
    except Exception:  # noqa: BLE001
        alive = victims
    for p in alive:
        try:
            p.kill()
        except Exception:  # noqa: BLE001
            pass

    killed = [p.pid for p in victims]
    logger.info("[reap] 清理上次遗留的 sidecar 进程 %d 个: %s", len(killed), killed)
    return len(killed)


class LocalRuntimeRegistry:
    CAPABILITIES = ("chat", "embedding", "rerank", "asr", "image-embedding")

    def __init__(self, *, chayuan_root: Path) -> None:
        self._managers: Dict[str, SidecarRuntimeManager] = {
            cap: SidecarRuntimeManager(
                chayuan_root=chayuan_root,
                engine=_CAP_ENGINE[cap],
                capability=cap,
                port_offset=i,
            )
            for i, cap in enumerate(self.CAPABILITIES)
        }

    def get(self, capability: str) -> SidecarRuntimeManager:
        if capability not in self._managers:
            raise ValueError(f"unknown capability: {capability!r}")
        return self._managers[capability]

    def all_statuses(self) -> Dict[str, RuntimeStatus]:
        return {cap: m.status for cap, m in self._managers.items()}

    async def stop_all(self) -> None:
        """关停所有 capability runtime;单个 stop 抛异常不阻塞其它。"""
        for cap, m in self._managers.items():
            try:
                await m.stop()
            except Exception as e:
                logger.warning("[registry] stop %s 异常: %r", cap, e)


_registry_singleton: Optional[LocalRuntimeRegistry] = None


def get_registry() -> LocalRuntimeRegistry:
    """进程内单例。第一次调用时按 CHAYUAN_ROOT 构造。"""
    global _registry_singleton
    if _registry_singleton is None:
        from chayuan import settings as cy_settings
        _registry_singleton = LocalRuntimeRegistry(chayuan_root=Path(cy_settings.CHAYUAN_ROOT))
    return _registry_singleton

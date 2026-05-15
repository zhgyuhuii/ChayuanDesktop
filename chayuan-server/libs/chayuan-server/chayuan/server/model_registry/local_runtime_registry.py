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

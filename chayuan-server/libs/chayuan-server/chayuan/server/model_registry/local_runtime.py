"""本地 LLM runtime 管理 (vendor 进集成版的 llama-server.exe)。

职责:
- 启动 / 停止 / 重启 vendor/services/llama-server/llama-server.exe 子进程
- 健康检查:轮询 /health,失败重试
- 状态写入 <CHAYUAN_ROOT>/runtime.json (前端读)
- 配置持久化到 <CHAYUAN_ROOT>/model_registry/local_runtime.yaml

设计:整个 chayuan-server 进程内一个 manager 单例,通过 get_manager() 拿。
sidecar lifespan shutdown 必须 await manager.stop() 级联关停 llama-server。
"""
from __future__ import annotations

import dataclasses
import json
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

import yaml


# ───────────────────────── 配置 / 状态 dataclass ─────────────────────────

@dataclasses.dataclass
class LocalRuntimeSettings:
    """本地 runtime 用户可配项,持久化到 local_runtime.yaml"""
    preload_on_startup: bool = True
    host: str = "127.0.0.1"
    port: int = 62582
    api_key: str = ""
    expose_lan: bool = False
    default_chat_model: str = ""

    @classmethod
    def load(cls, path: Path) -> "LocalRuntimeSettings":
        if not path.is_file():
            return cls()
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            return cls()
        return cls(**{
            k: data[k]
            for k in dataclasses.asdict(cls()).keys()
            if k in data
        })

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.safe_dump(dataclasses.asdict(self), allow_unicode=True),
            encoding="utf-8",
        )


@dataclasses.dataclass
class RuntimeStatus:
    """RuntimeManager 实时状态,序列化给 API 返回。"""
    state: Literal["stopped", "starting", "ready", "failed", "restarting"]
    endpoint: Optional[str] = None
    pid: Optional[int] = None
    model_id: Optional[str] = None
    model_path: Optional[str] = None
    started_at: Optional[datetime] = None
    last_health_at: Optional[datetime] = None
    last_error: Optional[str] = None

    def to_dict(self) -> dict:
        d = dataclasses.asdict(self)
        for k in ("started_at", "last_health_at"):
            if d[k] is not None:
                d[k] = d[k].isoformat()
        return d

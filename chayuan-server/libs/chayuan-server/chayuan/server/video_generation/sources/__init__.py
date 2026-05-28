"""在线素材源 connector 注册表。

每个 connector 实现 OnlineSource 协议:
    name: str
    requires_api_key: bool
    search(query, aspect, limit) -> list  # 暂用 list[Any],各 connector 定义自家结构
    download(url, save_dir) -> str | None  # 本地路径或 None

注册:在自身模块顶层调 register_source()。
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Protocol, runtime_checkable

logger = logging.getLogger("chayuan.video_generation.sources")


@runtime_checkable
class OnlineSource(Protocol):
    name: str
    requires_api_key: bool

    def search(self, query: str, aspect: str = "9:16", limit: int = 10) -> list: ...
    def download(self, url: str, save_dir: str) -> Optional[str]: ...


_REGISTRY: Dict[str, OnlineSource] = {}


def register_source(source: OnlineSource) -> OnlineSource:
    _REGISTRY[source.name] = source
    return source


def get_source(name: str) -> Optional[OnlineSource]:
    return _REGISTRY.get(name)


def list_sources() -> List[str]:
    return sorted(_REGISTRY.keys())


# Eager load 内置 connector(触发 register_source 调用)
from chayuan.server.video_generation.sources import ytdlp_source  # noqa: F401,E402

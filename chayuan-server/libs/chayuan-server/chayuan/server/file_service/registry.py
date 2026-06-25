from __future__ import annotations
from typing import Dict, Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileAdapter, FileRequestError

_ADAPTERS: Dict[str, FileAdapter] = {}


def register(adapter: FileAdapter) -> None:
    _ADAPTERS[adapter.kind] = adapter


def dispatch(kind: str, params: Mapping[str, str], *, user: Optional[dict], download: bool) -> Response:
    adapter = _ADAPTERS.get(kind)
    if adapter is None:
        raise FileRequestError(400, f"unknown file kind: {kind!r}")
    return adapter.handle(params, user, download=download)

from __future__ import annotations
from typing import Mapping, Optional, Protocol, runtime_checkable
from fastapi import Response


class FileRequestError(Exception):
    """adapter 层错误,路由转成 HTTPException。"""
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


@runtime_checkable
class FileAdapter(Protocol):
    kind: str
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response: ...

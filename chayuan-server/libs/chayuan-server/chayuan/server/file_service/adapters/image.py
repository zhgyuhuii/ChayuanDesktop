from __future__ import annotations
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.api_server.image_routes import serve_image_file


class ImageAdapter:
    kind = "image"

    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        sid = (params.get("source_id") or "").strip()
        iid = (params.get("image_id") or "").strip()
        if not sid.isdigit() or not iid:
            raise FileRequestError(400, "missing or invalid source_id/image_id")
        return serve_image_file(int(sid), iid, download=download, user=user)

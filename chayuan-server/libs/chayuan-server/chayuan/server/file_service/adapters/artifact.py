from __future__ import annotations
import mimetypes
from typing import Mapping, Optional
from fastapi import Response
from fastapi.responses import FileResponse
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.modality.router.artifacts import find_by_filename, fetch_from_storage


class ArtifactAdapter:
    """模态产物:内容寻址(name=sha.ext)。复用 artifacts 本地优先 + minio 回填。
    鉴权:路由层 require_auth_enabled 已确保登录;sha 本身是隐蔽凭证。"""
    kind = "artifact"

    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        name = (params.get("name") or "").strip()
        if not name or "/" in name or "\\" in name:
            raise FileRequestError(400, "missing or invalid artifact name")
        path = find_by_filename(name) or fetch_from_storage(name)
        if path is None:
            raise FileRequestError(404, "artifact not found")
        media = mimetypes.guess_type(name)[0] or "application/octet-stream"
        headers = {"Cache-Control": "public, max-age=31536000, immutable"}
        if download:
            headers["Content-Disposition"] = f"attachment; filename=\"{name}\""
        return FileResponse(str(path), media_type=media, headers=headers)

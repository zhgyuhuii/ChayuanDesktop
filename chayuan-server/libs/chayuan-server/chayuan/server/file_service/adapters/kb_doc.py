from __future__ import annotations
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.knowledge_base.kb_doc_api import download_doc
from chayuan.server.auth.access import can_read_kb


class KbDocAdapter:
    kind = "kb-doc"

    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        kb = (params.get("kb") or "").strip()
        file = (params.get("file") or "").strip()
        if not kb or not file:
            raise FileRequestError(400, "missing kb/file")
        if not can_read_kb(user, kb):
            raise FileRequestError(403, f"no read permission on kb {kb!r}")
        return download_doc(knowledge_base_name=kb, file_name=file, preview=not download)

# chayuan/server/file_service/adapters/dh.py
from __future__ import annotations
import os
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.file_service._response import file_response
from chayuan.server.video_generation.digital_human import store as dh_store
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.auth.deps import owner_id_of


class DhAvatarAdapter:
    kind = "dh-avatar"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        ref = (params.get("ref") or "").strip()
        if not ref:
            raise FileRequestError(400, "missing ref")
        p = dh_store.resolve_avatar_path(ref)
        if not p or not os.path.isfile(p):
            raise FileRequestError(404, "avatar not found")
        return file_response(p, download)


class DhProductAdapter:
    kind = "dh-product"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        ref = (params.get("ref") or "").strip()
        if not ref:
            raise FileRequestError(400, "missing ref")
        p = dh_store.resolve_product_path(ref)
        if not p or not os.path.isfile(p):
            raise FileRequestError(404, "product not found")
        return file_response(p, download)


class DhTaskAdapter:
    kind = "dh-task"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        tid = (params.get("task_id") or "").strip()
        if not tid:
            raise FileRequestError(400, "missing task_id")
        st = dh_jobs.get_status(tid, owner_id_of(user))
        if getattr(st, "state", None) != "complete" or not os.path.isfile(getattr(st, "result_path", "") or ""):
            raise FileRequestError(404, "product not ready")
        return file_response(st.result_path, download, media_type="video/mp4", filename="digital_human.mp4")

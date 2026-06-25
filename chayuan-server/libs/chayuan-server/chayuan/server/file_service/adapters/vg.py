# chayuan/server/file_service/adapters/vg.py
from __future__ import annotations
import os
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.file_service._response import file_response
from chayuan.server.video_generation import service as vg_service
from chayuan.server.video_generation import binaries
from chayuan.server.video_generation._helpers import task_dir, song_dir, resolve_path_within_directory
from chayuan.server.video_generation.store import materials as materials_store
from chayuan.server.auth.deps import owner_id_of


class VgTaskAdapter:
    kind = "vg-task"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        tid = (params.get("task_id") or "").strip()
        file = (params.get("file") or "").strip()
        if not tid or not file:
            raise FileRequestError(400, "missing task_id/file")
        if not vg_service.get_task(tid, owner_id=owner_id_of(user)):
            raise FileRequestError(404, "task not found")
        try:
            real = resolve_path_within_directory(task_dir(tid, create=False), file, require_file=True)
        except ValueError:
            raise FileRequestError(404, "file not found")
        return file_response(real, download)


class VgMaterialAdapter:
    kind = "vg-material"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        mid = (params.get("material_id") or "").strip()
        if not mid:
            raise FileRequestError(400, "missing material_id")
        row = materials_store.get_material(mid, owner_id=owner_id_of(user))
        if not row:
            raise FileRequestError(404, "material not found")
        path = row.get("path") or ""
        if path and not os.path.isfile(path):
            from chayuan.server.video_generation._helpers import storage_dir
            alt = os.path.join(storage_dir("materials"), os.path.basename(path))
            if os.path.isfile(alt):
                path = alt
        if not path or not os.path.isfile(path):
            raise FileRequestError(404, "material file missing")
        return file_response(path, download, media_type=row.get("mime") or None)


class VgBgmAdapter:
    kind = "vg-bgm"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        name = (params.get("name") or "").strip()
        if not name:
            raise FileRequestError(400, "missing name")
        base = os.path.basename(name)
        for d in (binaries.get_bgm_dir(), song_dir()):
            if d:
                p = os.path.join(d, base)
                if os.path.isfile(p):
                    return file_response(p, download)
        raise FileRequestError(404, "bgm not found")

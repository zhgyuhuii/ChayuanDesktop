# chayuan/server/file_service/_response.py
from __future__ import annotations
import os
from typing import Optional
from fastapi.responses import FileResponse


def file_response(path: str, download: bool, *, media_type: Optional[str] = None,
                  filename: Optional[str] = None) -> FileResponse:
    headers = {}
    if download:
        fn = filename or os.path.basename(path)
        headers["Content-Disposition"] = f'attachment; filename="{fn}"'
    return FileResponse(path, media_type=media_type, headers=headers)

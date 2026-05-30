"""数字人 REST —— 薄路由,逻辑在 digital_human/{store,jobs}。"""
from __future__ import annotations

import os
import time
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi import Path as FPath
from fastapi.responses import FileResponse

from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.video_generation._helpers import dh_avatars_dir, dh_products_dir
from chayuan.server.video_generation.digital_human import engine as dh_engine
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human.schemas import DhGenerateRequest

digital_human_router = APIRouter(prefix="/api/v1/digital-human", tags=["digital-human"])


@digital_human_router.get("/presets")
def list_presets(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = [p.model_dump() for p in store.list_presets()]
    return {"count": len(items), "items": items}


@digital_human_router.post("/presets")
def create_preset(body: Dict[str, Any],
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    try:
        p = store.create_preset(
            name=body["name"], avatar_ref=body["avatar_ref"],
            avatar_kind=body["avatar_kind"],
            voice_provider=body.get("voice_provider", "piper"),
            voice_name=body.get("voice_name", ""),
            is_greenscreen=bool(body.get("is_greenscreen", False)),
        )
    except KeyError as e:
        raise HTTPException(422, f"缺字段: {e}") from e
    return p.model_dump()


@digital_human_router.put("/presets/{pid}")
def update_preset(pid: str, body: Dict[str, Any],
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    p = store.update_preset(pid, **body)
    if p is None:
        raise HTTPException(404, "数字人不存在")
    return p.model_dump()


@digital_human_router.delete("/presets/{pid}")
def delete_preset(pid: str,
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return {"deleted": store.delete_preset(pid), "id": pid}


@digital_human_router.get("/avatars")
def list_avatars(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = store.list_avatars()
    return {"count": len(items), "items": items}


@digital_human_router.get("/engines")
def list_engines(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = dh_engine.list_engines()
    return {"count": len(items), "items": items}


@digital_human_router.post("/avatars")
async def upload_avatar(file: UploadFile = File(...),
                        user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp4"
    fid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}{ext}"
    dest = os.path.join(dh_avatars_dir(create=True), fid)
    with open(dest, "wb") as f:
        f.write(await file.read())
    kind = "image" if ext in {".jpg", ".jpeg", ".png", ".webp", ".bmp"} else "video"
    return {"ref": f"user:{fid}", "kind": kind, "source": "user", "name": fid}


@digital_human_router.post("/products")
async def upload_product(file: UploadFile = File(...),
                         user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    fid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}{ext}"
    dest = os.path.join(dh_products_dir(create=True), fid)
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"ref": f"product:{fid}", "name": fid}


@digital_human_router.delete("/avatars/{name}")
def delete_avatar(name: str = FPath(..., max_length=128),
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    p = os.path.join(dh_avatars_dir(), os.path.basename(name))
    removed = False
    if os.path.isfile(p):
        try:
            os.remove(p)
            removed = True
        except OSError:
            pass
    return {"deleted": removed, "name": name}


@digital_human_router.post("/generate")
def generate(body: DhGenerateRequest,
             width: int = 720, height: int = 1280,
             user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    tid = dh_jobs.submit(preset_id=body.preset_id, text=body.text,
                         width=width, height=height,
                         product_ref=body.product_image, template=body.template,
                         matte=body.matte, engine=body.engine)
    return {"task_id": tid}


@digital_human_router.get("/tasks/{tid}")
def task_status(tid: str,
                user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return dh_jobs.get_status(tid).model_dump()


@digital_human_router.get("/tasks/{tid}/file")
def task_file(tid: str,
              user: Dict[str, Any] = Depends(require_auth_enabled())) -> FileResponse:
    st = dh_jobs.get_status(tid)
    if st.state != "complete" or not os.path.isfile(st.result_path):
        raise HTTPException(404, "产物未就绪")
    return FileResponse(st.result_path, media_type="video/mp4", filename="digital_human.mp4")

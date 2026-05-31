"""数字人 REST —— 薄路由,逻辑在 digital_human/{store,jobs}。"""
from __future__ import annotations

import os
import time
import uuid
from typing import Any, Dict, List

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

_REALTIME_PORT = 18880


def _realtime_port_listening() -> bool:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.3)
    try:
        return s.connect_ex(("127.0.0.1", _REALTIME_PORT)) == 0
    finally:
        s.close()


@digital_human_router.get("/presets")
def list_presets(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = [p.model_dump() for p in store.list_presets()]
    return {"count": len(items), "items": items}


@digital_human_router.post("/presets")
def create_preset(body: Dict[str, Any],
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    try:
        p = store.create_preset(
            name=body["name"], avatar_ref=body.get("avatar_ref", ""),
            avatar_kind=body.get("avatar_kind", "image"),
            voice_provider=body.get("voice_provider", "piper"),
            voice_name=body.get("voice_name", ""),
            is_greenscreen=bool(body.get("is_greenscreen", False)),
            avatars=body.get("avatars"),
            compose_mode=body.get("compose_mode", "single"),
            layout=body.get("layout", "side"),
            video_width=int(body.get("video_width", 720) or 720),
            video_height=int(body.get("video_height", 1280) or 1280),
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


@digital_human_router.get("/avatars/file")
def avatar_file(ref: str,
                user: Dict[str, Any] = Depends(require_auth_enabled())) -> FileResponse:
    """按 avatar_ref(``bundled:<f>`` / ``user:<f>``)返形象文件,供预设卡片缩略图。
    ref 含冒号 → 用 query 参数(不进路径段)。"""
    p = store.resolve_avatar_path(ref)
    if not p or not os.path.isfile(p):
        raise HTTPException(404, "形象文件不存在")
    return FileResponse(p)


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


@digital_human_router.post("/avatars/compose")
async def compose_reference(files: List[UploadFile] = File(...),
                            user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """多照合一:上传同一人多张照片 → 挑最佳单帧存为一个 user 形象。
    受单图引擎约束,不做多参考身份建模,只是选最清晰一张。"""
    import shutil, tempfile
    from chayuan.server.video_generation.digital_human.reference import build_reference_image
    if not files:
        raise HTTPException(422, "至少上传一张照片")
    tmps: List[str] = []
    try:
        for uf in files:
            ext = os.path.splitext(uf.filename or "")[1].lower() or ".png"
            tf = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
            tf.write(await uf.read()); tf.close(); tmps.append(tf.name)
        chosen = build_reference_image(tmps)
        ext = os.path.splitext(chosen)[1].lower() or ".png"
        fid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}{ext}"
        dest = os.path.join(dh_avatars_dir(create=True), fid)
        shutil.copyfile(chosen, dest)
        return {"ref": f"user:{fid}", "kind": "image", "source": "user", "name": fid}
    finally:
        for t in tmps:
            try:
                os.unlink(t)
            except OSError:
                pass


@digital_human_router.post("/script/generate")
def script_generate(body: Dict[str, Any],
                    user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """主题 -> LLM 生成口播文案(复用 VG steps/script.generate_script)。"""
    from chayuan.server.video_generation.steps.script import generate_script
    subject = (body.get("subject") or "").strip()
    if not subject:
        raise HTTPException(422, "缺 subject(主题)")
    text = generate_script(
        subject, language=str(body.get("language", "") or ""),
        paragraph_number=int(body.get("paragraphs", 1) or 1),
        model=body.get("model"),
    )
    if not text:
        raise HTTPException(502, "文案生成失败(LLM 不可用?先在模型配置里设默认 chat 模型)")
    return {"script": text}


@digital_human_router.post("/script/from-video")
async def script_from_video(file: UploadFile = File(...),
                            user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """参考视频 -> 抽音轨 -> ASR 转写 -> LLM 改写成口播文案。"""
    import subprocess, tempfile
    from chayuan.server.modality.audio import AudioPipeline
    from chayuan.server.video_generation.steps.script import _invoke_llm
    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp4"
    tf = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tf.write(await file.read()); tf.close()
    wav = tf.name + ".16k.wav"
    try:
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:  # noqa: BLE001
            ff = "ffmpeg"
        subprocess.run([ff, "-y", "-i", tf.name, "-vn", "-ac", "1", "-ar", "16000", wav],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        transcript = (AudioPipeline()._transcribe_via_sidecar(wav) or "").strip()  # noqa: SLF001
        if not transcript:
            raise HTTPException(502, "参考视频转写为空(无人声?或 ASR 运行时未就绪)")
        prompt = (
            "下面是一段参考视频的语音转写。请据其主题与风格,改写成一段适合数字人口播"
            "朗读的短视频文案。只输出文案本身,不要前言后语/引号/markdown。原文如下:"
            + chr(10) + chr(10) + transcript
        )
        script = (_invoke_llm(prompt) or "").strip()
        return {"script": script or transcript, "transcript": transcript}
    finally:
        for pth in (tf.name, wav):
            try:
                os.unlink(pth)
            except OSError:
                pass


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


@digital_human_router.get("/tasks")
def list_tasks(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = [s.model_dump() for s in dh_jobs.list_statuses()]
    active = sum(1 for s in items if s.get("state") in ("pending", "running"))
    return {"count": len(items), "active": active, "items": items}


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


@digital_human_router.post("/tasks/{tid}/to-timeline")
def task_to_timeline(tid: str = FPath(..., max_length=64),
                     user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """把已完成任务的产物 mp4 注册进视频生成素材库(本地文件,不下载),
    用户即可在「视频生成 → 时间轴」里拿它做高级编排(同框/分段/字幕等)。"""
    st = dh_jobs.get_status(tid)
    if st.state != "complete" or not st.result_path or not os.path.isfile(st.result_path):
        raise HTTPException(409, "任务未完成或产物缺失")
    from chayuan.server.video_generation.store import materials as materials_store
    try:
        from chayuan.server.api_server.video_generation_routes import _owner_id_of
        owner = _owner_id_of(user)
    except Exception:  # noqa: BLE001
        owner = None
    row = materials_store.create_material(
        source="digital_human",
        name=os.path.basename(st.result_path),
        path=st.result_path,
        owner_id=owner,
        mime="video/mp4",
        size=os.path.getsize(st.result_path),
        tags=["digital_human"],
    )
    return {"material": row}


@digital_human_router.get("/live/available")
def live_available(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return {"available": _realtime_port_listening()}


@digital_human_router.post("/live/offer")
def live_offer(body: Dict[str, Any],
               user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """中继浏览器 SDP offer 到 realtime_avatar sidecar 的 /offer,返回 answer。"""
    import httpx
    if not _realtime_port_listening():
        raise HTTPException(503, "实时数字人运行时未启动(去运行时框架安装/启动)")
    with httpx.Client() as client:
        resp = client.post(f"http://127.0.0.1:{_REALTIME_PORT}/offer", json=body, timeout=30)
        resp.raise_for_status()
        return resp.json()

"""视频生成模块 HTTP 路由(M2)。

挂在 ``/api/v1/video-generation/*``,跟 kb-query / runtime 平级。

路由分组:
    脚本 / 关键词 / 字幕解析 / TTS 试听     —— Wizard step 1-2 辅助
    任务 CRUD + SSE 进度                   —— Wizard 主流程
    素材库 CRUD + 在线搜索                  —— Wizard step 5
    BGM / 字体 / 声音 资源列表              —— Wizard 选择器数据源
    文件流式下载                            —— 成品播放/下载

所有写操作 / 任务相关 endpoint 走 require_auth_enabled — 单机匿名 时
(AUTH_REQUIRED=false)透明放行 GUEST,多用户时强制 JWT。owner_id 由
GUEST_USER.id (-1) 还是真实 users.id 决定,store 层负责按这个 id 过滤。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException,
    Path as FPath, Query, Request, UploadFile, status,
)
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.video_generation import service as vg_service
from chayuan.server.video_generation.schemas import (
    AudioRequest,
    SrtCue,
    VideoParams,
    VideoScriptRequest,
    VideoTermsRequest,
)
from chayuan.server.video_generation.store import materials as materials_store
from chayuan.server.video_generation.store import videos as videos_store

logger = logging.getLogger("chayuan.api.video_generation")

video_generation_router = APIRouter(
    prefix="/api/v1/video-generation",
    tags=["Video Generation"],
)


def _owner_id_of(user: Dict[str, Any]) -> Optional[int]:
    """从 auth 返回的 user dict 抽 owner_id;GUEST(-1)映射成 None(全局共享)。"""

    if not user:
        return None
    uid = user.get("id")
    if uid is None or uid < 0:
        return None
    return int(uid)


def _diagnose_tts_failure(*, provider: str, voice_name: str) -> Dict[str, Any]:
    """preview_audio 返 None 时主动诊断 — 把每一档可能原因塞进 502 detail。

    synthesize 内部每档失败都 logger.warning,但 client 拿不到 log。
    本 helper 同步检查 piper 包是否能 import / voice 路径是否解析 /
    bundled+user-local 目录是否存在,让前端"试听失败"对话框直接看到根因
    (例如 piper-tts 未装 vs voice .onnx 缺文件 — 两种修法完全不同)。
    """
    diag: Dict[str, Any] = {
        "code": "tts_synthesize_failed",
        "provider": provider,
        "voice_name": voice_name or "(空,会用默认)",
        "checks": {},
        "hint": "",
    }
    checks: Dict[str, Any] = diag["checks"]

    if provider == "piper":
        # 1) piper 包 import
        try:
            import piper.voice as _pv  # type: ignore  # noqa: F401
            checks["piper_import"] = "ok"
        except Exception as e:  # noqa: BLE001
            checks["piper_import"] = f"FAIL: {type(e).__name__}: {e}"
            diag["hint"] = (
                "piper-tts 包未装或 PyInstaller bundle 漏抓。"
                "查看 server log 完整 stack;dev 环境 `pip install piper-tts`,"
                "desktop bundle 需在 spec hiddenimports 显式加 piper.voice。"
            )
            return diag
        # 2) voice path 解析(尝试 AudioPipeline 的 resolver)
        try:
            from chayuan.server.modality.audio import AudioPipeline
            am = AudioPipeline()
            resolved = am._resolve_piper_voice_path(voice_name or "")
            checks["voice_path"] = resolved or "(未解析到 .onnx)"
        except Exception as e:  # noqa: BLE001
            checks["voice_path"] = f"resolver FAIL: {type(e).__name__}: {e}"
            resolved = None
        # 3) 检查 CHAYUAN_ROOT bundled / user-local 目录
        try:
            from chayuan.settings import CHAYUAN_ROOT
            bundled = CHAYUAN_ROOT / "models" / "bundled" / "tts" / "piper"
            userloc = CHAYUAN_ROOT / "models" / "piper"
            checks["bundled_dir"] = (
                f"{bundled} (exists={bundled.is_dir()})"
            )
            checks["user_local_dir"] = (
                f"{userloc} (exists={userloc.is_dir()})"
            )
            if bundled.is_dir():
                onnxs = sorted(str(p.relative_to(bundled)) for p in bundled.rglob("*.onnx"))[:5]
                checks["bundled_onnx_sample"] = onnxs or "(no .onnx files)"
        except Exception as e:  # noqa: BLE001
            checks["chayuan_root_probe"] = f"FAIL: {type(e).__name__}: {e}"
        if not resolved:
            diag["hint"] = (
                "piper 包能 import,但 voice 模型 .onnx 文件未找到。"
                "请下载 piper voice(rhasspy/piper-voices,zh_CN-huayan-medium 推荐)"
                "放到 user_local_dir,或开 CHAYUAN_PIPER_AUTO_DOWNLOAD=1 让 server 自动拉。"
            )
        else:
            diag["hint"] = (
                "voice 文件能找到但合成失败 — 多半 PiperVoice.load 或 synthesize_wav 异常。"
                "查 server log 完整 stack;可能是 onnx runtime 版本不兼容或文本字符问题。"
            )
    elif provider == "edge":
        diag["hint"] = (
            "edge-tts 联网失败常见原因:网络不可达 / proxy / Microsoft 端服务异常。"
            "可改用 piper(离线)。"
        )
    elif provider == "sherpa":
        diag["hint"] = (
            "sherpa-onnx 失败常见原因:VITS model 未下载或路径未配。"
            "查 /api/v1/video-generation/voices?provider=sherpa 看可用 voice。"
        )
    else:
        diag["hint"] = f"未知 provider={provider!r},应为 piper/edge/sherpa 之一"
    return diag


# ─────────────────────────────────────────────────────────────────────
# 1. 脚本 / 关键词 / 字幕解析
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.post(
    "/script", summary="LLM 生成视频文案(同步;wizard step 2 ai 模式)",
)
def gen_script(
    body: VideoScriptRequest,
    model: Optional[str] = Query(None, description="可选,覆盖默认 chat 模型"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.steps import script as script_step
    text = script_step.generate_script(
        body.video_subject,
        language=body.video_language,
        paragraph_number=body.paragraph_number,
        model=model,
    )
    if not text:
        raise HTTPException(502, "LLM 调用失败或返回空脚本 — 请检查模型广场配置")
    return {"video_script": text}


@video_generation_router.post(
    "/terms", summary="LLM 生成搜索关键词(给在线素材搜索用)",
)
def gen_terms(
    body: VideoTermsRequest,
    model: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.steps import script as script_step
    terms = script_step.generate_terms(
        body.video_subject, body.video_script, amount=body.amount, model=model,
    )
    return {"video_terms": terms}


@video_generation_router.post(
    "/subtitle/parse",
    summary="解析用户粘贴的 SRT/VTT 文本(粘贴字幕 mode 前端实时校验)",
)
def parse_srt(
    body: Dict[str, str] = Body(..., examples=[{"srt_text": "..."}]),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.steps import subtitle as subtitle_step
    srt_text = (body or {}).get("srt_text") or ""
    cues = subtitle_step.cues_from_srt_text(srt_text)
    return {
        "count": len(cues),
        "cues": [c.model_dump() for c in cues],
    }


@video_generation_router.post(
    "/preview-audio",
    summary="TTS 试听一段(不创建任务;给语音步骤选择器试听用)",
)
def preview_audio(
    body: AudioRequest,
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> StreamingResponse:
    """合成 → 流式返回 audio/wav bytes。失败 502。

    限制:body.video_script 长度 <= 200 字符,避免被滥用做完整 TTS。
    """

    text = (body.video_script or "").strip()
    if not text:
        raise HTTPException(400, "video_script 不能为空")
    if len(text) > 200:
        raise HTTPException(413, "试听文本超过 200 字符限制")

    import tempfile
    from chayuan.server.video_generation.steps import tts as tts_step
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        result = tts_step.synthesize(
            text, tmp.name,
            voice_provider=body.voice_provider,
            voice_name=body.voice_name or None,
            voice_rate=body.voice_rate, voice_volume=body.voice_volume,
        )
        if not result:
            # CLAUDE.md "修 bug 前的强制纪律" — 502 不能 catch-all 吞细节。
            # synthesize 已把每一档失败 warning 进 server log,但客户端拿不到。
            # 主动跑一次诊断回灌到 detail,让 client / 试听对话框直接看到根因。
            raise HTTPException(
                status_code=502,
                detail=_diagnose_tts_failure(
                    provider=body.voice_provider,
                    voice_name=body.voice_name or "",
                ),
            )
        with open(result.audio_file, "rb") as f:
            data = f.read()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    headers = {
        "Content-Type": "audio/wav",
        "X-Audio-Duration-Ms": str(result.duration_ms),
        "X-Tts-Provider": result.provider,
    }
    return StreamingResponse(iter([data]), media_type="audio/wav", headers=headers)


# ─────────────────────────────────────────────────────────────────────
# 2. 任务 CRUD
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.post(
    "/tasks", summary="提交视频生成任务",
    status_code=status.HTTP_202_ACCEPTED,
)
def submit_task(
    params: VideoParams,
    stop_at: str = Query(
        "video",
        pattern="^(script|terms|audio|subtitle|materials|video)$",
        description="可截断流程,wizard 单步预览用",
    ),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    row = vg_service.submit_task(
        params, owner_id=_owner_id_of(user), stop_at=stop_at,
    )
    return row


@video_generation_router.post(
    "/tasks/batch", summary="批量提交:N 个主题共享一套参数,并发跑",
    status_code=status.HTTP_202_ACCEPTED,
)
def submit_batch(
    body: Dict[str, Any] = Body(
        ...,
        description="{subjects: list[str], shared_params: VideoParams}",
    ),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    """BatchModePage 用 — 多主题列表 + 一套全局参数(语音/字幕/画幅/BGM)一
    键提交。后端循环创建 vg_task,runner ThreadPoolExecutor 自动并发跑(默
    认 4 worker,env CHAYUAN_VG_RUNNER_WORKERS override)。

    script_source 自动锁 'ai'(批量场景全自动 — LLM 生成各主题脚本)。
    """

    subjects = body.get("subjects") or []
    if not isinstance(subjects, list) or not subjects:
        raise HTTPException(400, "subjects 必填,数组形态")
    shared_raw = body.get("shared_params") or {}
    try:
        shared_params = VideoParams.model_validate(shared_raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"shared_params 校验失败: {e}") from e

    rows = vg_service.submit_batch_tasks(
        [str(s) for s in subjects],
        shared_params,
        owner_id=_owner_id_of(user),
    )
    return {
        "submitted": len(rows),
        "skipped": len(subjects) - len(rows),
        "tasks": rows,
    }


@video_generation_router.get(
    "/tasks", summary="列任务(分页)",
)
def list_tasks(
    state: Optional[str] = Query(
        None,
        pattern="^(pending|processing|complete|failed|canceled)$",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    rows, total = vg_service.list_tasks(
        owner_id=_owner_id_of(user), state=state,
        page=page, page_size=page_size,
    )
    return {"total": total, "items": rows, "page": page, "page_size": page_size}


@video_generation_router.get(
    "/tasks/{task_id}", summary="单任务详情",
)
def get_task(
    task_id: str = FPath(..., description="task UUID"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    row = vg_service.get_task(task_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "task not found")
    return row


@video_generation_router.delete(
    "/tasks/{task_id}", summary="删任务 + 清理磁盘文件",
)
def delete_task(
    task_id: str = FPath(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    ok = vg_service.delete_task(task_id, owner_id=_owner_id_of(user))
    if not ok:
        raise HTTPException(404, "task not found")
    return {"deleted": True}


@video_generation_router.post(
    "/tasks/{task_id}/cancel", summary="请求取消任务(worker 在 step 边界响应)",
)
def cancel_task(
    task_id: str = FPath(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    ok = vg_service.cancel_task(task_id, owner_id=_owner_id_of(user))
    if not ok:
        raise HTTPException(404, "task not found or not owned by user")
    return {"canceled": True}


# ─────────────────────────────────────────────────────────────────────
# 3. 任务进度 SSE
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.get(
    "/tasks/{task_id}/events",
    summary="任务进度 SSE — 前端 wizard step 7 渲染圆环用",
)
async def task_events(
    request: Request,
    task_id: str = FPath(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
):
    """轮询 vg_tasks.state/progress 推送给客户端。

    实现说明:M1 store.update_progress 是同步 DB 写,没自带 pub/sub;
    SSE 端用 2Hz 轮询 + 25s ping。任务进入终态(complete/failed/canceled)
    时再推一次然后关闭。

    M4 可改造为 store 写时 publish 到内存 channel + SSE 直接订阅,避免
    轮询;暂时 2Hz 单任务 DB 查询负载可忽略。
    """

    owner_id = _owner_id_of(user)
    row = vg_service.get_task(task_id, owner_id=owner_id)
    if not row:
        raise HTTPException(404, "task not found")

    async def _gen():
        last_state: Optional[str] = None
        last_progress: int = -1
        last_ping = time.monotonic()
        # 初始全量快照
        snap = vg_service.get_task(task_id, owner_id=owner_id)
        if snap:
            yield {
                "event": "task.snapshot",
                "data": json.dumps(snap, ensure_ascii=False),
            }
            last_state = snap.get("state")
            last_progress = int(snap.get("progress") or 0)

        while True:
            if await request.is_disconnected():
                break
            try:
                cur = vg_service.get_task(task_id, owner_id=owner_id)
            except Exception as e:  # noqa: BLE001
                logger.warning("[vg.sse] get_task failed: %r", e)
                cur = None
            if cur:
                cstate = cur.get("state")
                cprog = int(cur.get("progress") or 0)
                if cstate != last_state or cprog != last_progress:
                    yield {
                        "event": "task.update",
                        "data": json.dumps(cur, ensure_ascii=False),
                    }
                    last_state = cstate
                    last_progress = cprog
                if cstate in ("complete", "failed", "canceled"):
                    # 终态:推一次后关闭流
                    break
            await asyncio.sleep(0.5)
            if time.monotonic() - last_ping > 25.0:
                yield {"event": "ping", "data": str(int(time.time()))}
                last_ping = time.monotonic()

    return EventSourceResponse(_gen())


# ─────────────────────────────────────────────────────────────────────
# 4. 素材库
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.get(
    "/materials", summary="列素材库(用户私有 + 全局 bundled 合并视图)",
)
def list_materials(
    source: Optional[str] = Query(
        None, pattern="^(upload|pexels|pixabay|bundled)$",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    rows, total = materials_store.list_materials(
        owner_id=_owner_id_of(user), source=source,
        page=page, page_size=page_size,
    )
    return {"total": total, "items": rows, "page": page, "page_size": page_size}


@video_generation_router.post(
    "/materials", summary="上传素材文件",
    status_code=status.HTTP_201_CREATED,
)
async def upload_material(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    tags: Optional[str] = Form(None, description="逗号分隔标签"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation._helpers import storage_dir
    from chayuan.server.video_generation._helpers import parse_extension

    ext = parse_extension(file.filename or "") or "mp4"
    if ext not in ("mp4", "mov", "mkv", "webm", "jpg", "jpeg", "png", "bmp"):
        raise HTTPException(415, f"不支持的素材类型: .{ext}")
    upload_dir = storage_dir("materials", create=True)
    target_name = name or file.filename or f"upload_{int(time.time())}.{ext}"
    target_path = os.path.join(upload_dir, target_name)
    # 顺序写盘,避免大文件占内存
    size = 0
    with open(target_path, "wb") as out:
        while True:
            chunk = await file.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            size += len(chunk)

    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
    row = materials_store.create_material(
        source="upload",
        name=target_name,
        path=target_path,
        owner_id=_owner_id_of(user),
        mime=file.content_type or "",
        size=size,
        tags=tag_list,
    )
    return row


@video_generation_router.delete(
    "/materials/{material_id}", summary="删素材",
)
def delete_material(
    material_id: str = FPath(...),
    drop_file: bool = Query(True, description="是否一并删掉磁盘文件"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    row = materials_store.get_material(
        material_id, owner_id=_owner_id_of(user),
    )
    if not row:
        raise HTTPException(404, "material not found")
    ok = materials_store.delete_material(
        material_id, owner_id=_owner_id_of(user),
    )
    if ok and drop_file:
        try:
            p = row.get("path")
            if p and os.path.isfile(p):
                os.unlink(p)
        except OSError as e:
            logger.warning("[vg] drop_file failed: %r", e)
    return {"deleted": ok}


@video_generation_router.get(
    "/materials/search",
    summary="在线搜素材(Pexels/Pixabay)— 需配 API Key",
)
def search_materials(
    q: str = Query(..., min_length=1, max_length=120),
    source: str = Query("pexels", pattern="^(pexels|pixabay)$"),
    aspect: str = Query("9:16", pattern="^(16:9|9:16|1:1)$"),
    minimum_duration: int = Query(5, ge=1, le=120),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation.schemas import VideoAspect
    try:
        fn = (
            materials_step.search_videos_pexels if source == "pexels"
            else materials_step.search_videos_pixabay
        )
        items = fn(
            search_term=q,
            minimum_duration=minimum_duration,
            video_aspect=VideoAspect(aspect),
        )
    except ValueError as e:
        # API Key 未配
        raise HTTPException(412, str(e)) from e
    return {
        "count": len(items),
        "items": [
            {"provider": it.provider, "url": it.url, "duration": it.duration}
            for it in items
        ],
    }


# ─────────────────────────────────────────────────────────────────────
# 5. BGM / 字体 / 声音
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.get(
    "/bgm", summary="列 BGM(内置 bundled + 用户上传合并)",
)
def list_bgm(
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation import binaries
    from chayuan.server.video_generation._helpers import song_dir

    items: List[Dict[str, Any]] = []
    # bundled
    bundled = binaries.get_bgm_dir()
    if bundled and os.path.isdir(bundled):
        for f in sorted(os.listdir(bundled)):
            if f.lower().endswith((".mp3", ".wav", ".m4a", ".aac", ".ogg")):
                p = os.path.join(bundled, f)
                items.append(
                    {"name": f, "path": p, "source": "bundled",
                     "size": os.path.getsize(p)},
                )
    # 用户上传
    user_dir = song_dir()
    if os.path.isdir(user_dir):
        for f in sorted(os.listdir(user_dir)):
            if f.lower().endswith((".mp3", ".wav", ".m4a", ".aac", ".ogg")):
                p = os.path.join(user_dir, f)
                items.append(
                    {"name": f, "path": p, "source": "upload",
                     "size": os.path.getsize(p)},
                )
    return {"count": len(items), "items": items}


@video_generation_router.post(
    "/bgm", summary="上传 BGM 文件",
    status_code=status.HTTP_201_CREATED,
)
async def upload_bgm(
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation._helpers import song_dir, parse_extension
    ext = parse_extension(file.filename or "")
    if ext not in ("mp3", "wav", "m4a", "aac", "ogg"):
        raise HTTPException(415, f"不支持的 BGM 类型: .{ext}")
    target_dir = song_dir()
    target_name = file.filename or f"upload_{int(time.time())}.{ext}"
    target_path = os.path.join(target_dir, target_name)
    size = 0
    with open(target_path, "wb") as out:
        while True:
            chunk = await file.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            size += len(chunk)
    return {"name": target_name, "path": target_path, "size": size}


@video_generation_router.get(
    "/fonts", summary="列字体(vendor/bundled_fonts + 用户字体合并)",
)
def list_fonts(
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation import binaries
    from chayuan.server.video_generation._helpers import font_dir

    items: List[Dict[str, Any]] = []
    bundled = binaries.get_fonts_dir()
    if bundled and os.path.isdir(bundled):
        for f in sorted(os.listdir(bundled)):
            if f.lower().endswith((".ttc", ".ttf", ".otf")):
                items.append({"name": f, "source": "bundled"})
    user_dir = font_dir()
    if os.path.isdir(user_dir):
        for f in sorted(os.listdir(user_dir)):
            if f.lower().endswith((".ttc", ".ttf", ".otf")):
                items.append({"name": f, "source": "user"})
    return {"count": len(items), "items": items}


@video_generation_router.get(
    "/voices", summary="列可用 TTS 声音(按 provider)",
)
def list_voices(
    provider: str = Query(
        "piper", pattern="^(piper|edge|sherpa)$",
        description="对应 voice_provider 字段",
    ),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    """M1 简版:piper 只返默认音色名;edge 返几个常用中文 voice;sherpa M4 接。

    完整 voice 列表(piper voices ~80 个,edge voices ~300 个)由 M4 通过
    后端模型 registry 同步,避免每次列表往返查 HuggingFace/Microsoft。
    """

    if provider == "piper":
        voices = [
            {"id": "zh_CN-huayan-medium",
             "label": "中文女声(huayan medium)", "language": "zh-CN"},
        ]
    elif provider == "edge":
        voices = [
            {"id": "zh-CN-XiaoxiaoNeural",   "label": "晓晓(中文女声)", "language": "zh-CN"},
            {"id": "zh-CN-YunxiNeural",      "label": "云希(中文男声)", "language": "zh-CN"},
            {"id": "zh-CN-YunjianNeural",    "label": "云健(中文男声)", "language": "zh-CN"},
            {"id": "zh-CN-XiaoyiNeural",     "label": "晓伊(中文女声)", "language": "zh-CN"},
            {"id": "en-US-AriaNeural",       "label": "Aria (US, female)", "language": "en-US"},
            {"id": "en-US-GuyNeural",        "label": "Guy (US, male)",    "language": "en-US"},
        ]
    else:  # sherpa
        # 扫 bundled_models/tts/sherpa-onnx/ 子目录返实际可用 voice。
        # 名称规约:目录名即 voice_id;含 model.onnx 视为可用。
        voices = _scan_sherpa_voices()
    return {"provider": provider, "count": len(voices), "items": voices}


def _scan_sherpa_voices() -> List[Dict[str, Any]]:
    """扫描 sherpa-onnx voice 目录列表 — CHAYUAN_ROOT 装机 seed + 开发期
    vendor 两档同时扫,merge 去重。

    voice id 即目录名(如 ``vits-zh-ll``);label 用 SHERPA_VOICE_LABELS 映射
    人类可读名,缺则取 id。
    """

    import os
    candidates: List[str] = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        candidates.append(os.path.join(str(CHAYUAN_ROOT), "models", "bundled", "tts", "sherpa-onnx"))
    except Exception:  # noqa: BLE001
        pass

    here = os.path.realpath(__file__)
    parent = here
    for _ in range(8):
        parent = os.path.dirname(parent)
        cand = os.path.join(parent, "vendor", "bundled_models", "tts", "sherpa-onnx")
        if os.path.isdir(cand):
            candidates.append(cand)
            break

    seen: set = set()
    items: List[Dict[str, Any]] = []
    for root in candidates:
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            if name in seen:
                continue
            vd = os.path.join(root, name)
            if not os.path.isdir(vd):
                continue
            if not os.path.isfile(os.path.join(vd, "model.onnx")):
                continue
            seen.add(name)
            label = SHERPA_VOICE_LABELS.get(name, name)
            items.append({"id": name, "label": label, "language": "zh-CN"})
    return items


SHERPA_VOICE_LABELS: Dict[str, str] = {
    "vits-zh-ll": "中文多说话人(VITS LL,高质量)",
    "vits-zh-aishell3": "中文多说话人(AISHELL3)",
    "vits-melo-tts-zh_en": "中文+英文(MeloTTS)",
}


# ─────────────────────────────────────────────────────────────────────
# 6. 文件流式下载 / 预览
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.get(
    "/files/{task_id}/{file_name}",
    summary="任务产物文件下载 / 预览(音频 / 字幕 / 成品视频)",
)
def serve_task_file(
    task_id: str = FPath(...),
    file_name: str = FPath(...),
    download: bool = Query(False, description="True 强制下载,False 浏览器内联预览"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    from chayuan.server.video_generation._helpers import (
        task_dir, resolve_path_within_directory,
    )
    # 校验任务归属
    row = vg_service.get_task(task_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "task not found")
    base = task_dir(task_id, create=False)
    try:
        real = resolve_path_within_directory(base, file_name, require_file=True)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{os.path.basename(real)}"'
    return FileResponse(real, headers=headers)


@video_generation_router.get(
    "/videos", summary="列我的成品视频(我的视频页用)",
)
def list_videos(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    rows, total = videos_store.list_videos(
        owner_id=_owner_id_of(user), page=page, page_size=page_size,
    )
    return {"total": total, "items": rows, "page": page, "page_size": page_size}


@video_generation_router.delete(
    "/videos/{video_id}", summary="删成品视频(可选清理磁盘)",
)
def delete_video(
    video_id: str = FPath(...),
    drop_file: bool = Query(True),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    row = videos_store.get_video(video_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "video not found")
    ok = videos_store.delete_video(video_id, owner_id=_owner_id_of(user))
    if ok and drop_file:
        try:
            p = row.get("path")
            if p and os.path.isfile(p):
                os.unlink(p)
        except OSError as e:
            logger.warning("[vg] drop_file failed: %r", e)
    return {"deleted": ok}


# ─────────────────────────────────────────────────────────────────────
# 7. 在线素材源 API Key 配置(R1.5 加)
# ─────────────────────────────────────────────────────────────────────


@video_generation_router.get(
    "/sources/config", summary="列在线素材源配置(API Key 默认脱敏)",
)
def list_source_configs(
    reveal: bool = Query(False, description="仅 admin;reveal=true 返明文 key"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.sources import config_store as cs
    is_admin = bool(user.get("role") == "admin") if isinstance(user, dict) else False
    rows = cs.list_configs(reveal=reveal and is_admin)
    return {"items": rows}


@video_generation_router.post(
    "/sources/config", summary="upsert 单个在线素材源配置",
)
def upsert_source_config(
    body: Dict[str, Any] = Body(..., examples=[{
        "source_name": "pexels", "enabled": True, "api_key": "xxx",
    }]),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.sources import config_store as cs
    name = (body or {}).get("source_name") or ""
    if not name:
        raise HTTPException(400, "source_name 必填")
    return cs.upsert_config(
        name,
        enabled=body.get("enabled"),
        api_key=body.get("api_key"),
        config=body.get("config"),
    )

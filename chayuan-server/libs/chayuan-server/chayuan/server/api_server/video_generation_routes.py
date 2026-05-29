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
    # 先清理服务重启遗留的僵尸任务(processing 但无 worker)→ failed(可重试),
    # 避免「我的视频」一直显示卡死的进行中任务。
    try:
        vg_service.reconcile_orphaned()
    except Exception as e:  # noqa: BLE001
        logger.warning("[vg] reconcile_orphaned 失败(忽略): %r", e)
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


@video_generation_router.post(
    "/tasks/{task_id}/retry", summary="重试/继续任务(失败/取消/重启中断都可)",
)
def retry_task(
    task_id: str = FPath(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    ok = vg_service.retry_task(task_id, owner_id=_owner_id_of(user))
    if not ok:
        raise HTTPException(404, "task not found / params 无效")
    return {"retried": True}


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


def _maybe_translate_query(q: str, auto_translate: bool) -> str:
    """非 ASCII(含中文)且开启时,用 generate_terms 转英文取首词;否则原样返回。

    Pexels/Pixabay stock 库是英文标签索引,中文 query 命中率近 0。
    """
    if not auto_translate:
        return q
    if q.isascii():
        return q
    try:
        from chayuan.server.video_generation.steps import script as script_step
        terms = script_step.generate_terms(q, q, amount=1)
        if terms and isinstance(terms, list) and terms[0].strip():
            return terms[0].strip()
    except Exception as e:  # noqa: BLE001
        logger.warning("[vg] search 英文化失败,用原词: %r", e)
    return q


@video_generation_router.get(
    "/materials/search",
    summary="在线搜素材(Pexels/Pixabay)— 需配 API Key",
)
def search_materials(
    q: str = Query(..., min_length=1, max_length=120),
    source: str = Query("pexels", pattern="^(pexels|pixabay)$"),
    aspect: str = Query("9:16", pattern="^(16:9|9:16|1:1)$"),
    minimum_duration: int = Query(5, ge=1, le=120),
    auto_translate: bool = Query(True, description="非英文 query 自动转英文再搜"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation.schemas import VideoAspect
    effective_q = _maybe_translate_query(q, auto_translate)
    try:
        fn = (
            materials_step.search_videos_pexels if source == "pexels"
            else materials_step.search_videos_pixabay
        )
        items = fn(
            search_term=effective_q,
            minimum_duration=minimum_duration,
            video_aspect=VideoAspect(aspect),
        )
    except ValueError as e:
        raise HTTPException(412, str(e)) from e
    return {
        "count": len(items),
        "query": q,
        "translated_query": effective_q if effective_q != q else None,
        "items": [
            {"provider": it.provider, "url": it.url, "duration": it.duration,
             "image": getattr(it, "image", "")}
            for it in items
        ],
    }


@video_generation_router.get(
    "/materials/extract-media",
    summary="从链接提取多个媒体(网页 img/video + 视频平台)",
)
def extract_media_route(
    url: str = Query(..., min_length=4, max_length=2048),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.url_extractor import extract_media
    try:
        return extract_media(url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.warning("[vg] extract-media 异常: %r", e)
        raise HTTPException(502, f"提取失败: {e}") from e


@video_generation_router.post(
    "/materials/ingest",
    summary="把远程媒体(在线搜索/链接结果)下载落地并登记进素材库",
    status_code=status.HTTP_201_CREATED,
)
def ingest_material(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    """body: {url:str, kind:'video'|'image', source:str}. 返回新建的 VgMaterial。"""
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation._helpers import storage_dir

    url = str(body.get("url") or "").strip()
    kind = str(body.get("kind") or "video").strip()
    source = str(body.get("source") or "online").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "url 必须是 http(s)")

    mat_dir = storage_dir("materials", create=True)
    if kind == "image":
        path = materials_step.save_image(url, save_dir=mat_dir)
        mime = "image/jpeg"
    else:
        path = materials_step.save_video(url, save_dir=mat_dir)
        mime = "video/mp4"
    if not path or not os.path.isfile(path):
        raise HTTPException(502, "下载失败或文件无效")

    row = materials_store.create_material(
        source=source,
        name=os.path.basename(path),
        path=path,
        owner_id=_owner_id_of(user),
        mime=mime,
        size=os.path.getsize(path),
        tags=["online", source],
    )
    return row


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


@video_generation_router.get(
    "/bgm/{name}/file", summary="BGM 文件流式(试听/下载)",
)
def serve_bgm_file(
    name: str = FPath(..., max_length=255),
    download: bool = Query(False),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    from chayuan.server.video_generation import binaries
    from chayuan.server.video_generation._helpers import song_dir

    base = os.path.basename(name)  # 去路径分量,防遍历
    candidates: List[str] = []
    bundled = binaries.get_bgm_dir()
    if bundled:
        candidates.append(os.path.join(bundled, base))
    candidates.append(os.path.join(song_dir(), base))
    for p in candidates:
        if os.path.isfile(p):
            headers: Dict[str, str] = {}
            if download:
                headers["Content-Disposition"] = f'attachment; filename="{base}"'
            return FileResponse(p, headers=headers)
    raise HTTPException(404, f"BGM not found: {base}")


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
    # bundled / user:name=裸文件名,compose 拼字体目录;family 读 name 表本地化名
    bundled = binaries.get_fonts_dir()
    if bundled and os.path.isdir(bundled):
        for f in sorted(os.listdir(bundled)):
            if f.lower().endswith((".ttc", ".ttf", ".otf")):
                fam = _font_family(os.path.join(bundled, f))
                items.append({"name": f, "label": fam or f, "family": fam, "source": "bundled"})
    user_dir = font_dir()
    if os.path.isdir(user_dir):
        for f in sorted(os.listdir(user_dir)):
            if f.lower().endswith((".ttc", ".ttf", ".otf")):
                fam = _font_family(os.path.join(user_dir, f))
                items.append({"name": f, "label": fam or f, "family": fam, "source": "user"})
    # system:name=绝对路径(compose 直接用),label=family 名(读不到回退文件名)
    items.extend(_scan_system_fonts(seen={i["name"].lower() for i in items}))
    # 按显示名排序(family 优先)
    items.sort(key=lambda x: (x.get("label") or x["name"]).lower())
    return {"count": len(items), "items": items}


def _scan_system_fonts(seen: set) -> List[Dict[str, Any]]:
    """扫操作系统字体目录,返 [{name:<绝对路径>, label:<文件名>, source:'system'}]。

    compose.py 的字体解析对绝对路径直接使用(不拼字体目录),所以系统字体的
    name 用绝对路径。按文件名(小写)去重,避免同名重复。
    """
    import sys

    dirs: List[str] = []
    if sys.platform.startswith("win"):
        win = os.environ.get("WINDIR", r"C:\Windows")
        dirs.append(os.path.join(win, "Fonts"))
        local = os.environ.get("LOCALAPPDATA")
        if local:
            dirs.append(os.path.join(local, "Microsoft", "Windows", "Fonts"))
    elif sys.platform == "darwin":
        dirs += [
            "/System/Library/Fonts",
            "/Library/Fonts",
            os.path.expanduser("~/Library/Fonts"),
        ]
    else:  # linux / 其它
        dirs += [
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            os.path.expanduser("~/.fonts"),
            os.path.expanduser("~/.local/share/fonts"),
        ]

    out: List[Dict[str, Any]] = []
    seen_names = set(seen)
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        try:
            for root, _dirs, files in os.walk(d):
                for f in files:
                    if not f.lower().endswith((".ttc", ".ttf", ".otf")):
                        continue
                    key = f.lower()
                    if key in seen_names:
                        continue
                    seen_names.add(key)
                    full = os.path.join(root, f)
                    fam = _font_family(full)
                    out.append({
                        "name": full,
                        "label": fam or f,
                        "family": fam,
                        "source": "system",
                    })
        except OSError:
            continue
    out.sort(key=lambda x: (x.get("label") or x["name"]).lower())
    return out


# 字体 family 名缓存:key=(abspath, mtime) → family str(或 None)。
# 只读字体 name 表(几 KB),不加载整个字体;mtime 变了才重解析。
_FONT_FAMILY_CACHE: Dict[tuple, Optional[str]] = {}

# 系统语言对应的 OpenType langID(Windows 平台 platformID=3),优先取该语言名。
# 简体中文 0x0804;繁体 0x0404;英文 0x0409。按系统 locale 推首选,fallback 英文。
def _preferred_lang_ids() -> List[int]:
    import locale
    ids: List[int] = []
    try:
        loc = (locale.getdefaultlocale()[0] or "").lower()
    except Exception:  # noqa: BLE001
        loc = ""
    if loc.startswith("zh_cn") or loc.startswith("zh-cn") or loc == "zh":
        ids = [0x0804, 0x0404]
    elif loc.startswith("zh"):
        ids = [0x0404, 0x0804]
    # 任何中文环境都优先中文名;最后兜英文
    ids.append(0x0409)
    return ids


def _read_name_table_family(path: str) -> Optional[str]:
    """读 TTF/TTC/OTF 的 sfnt `name` 表,返字体 family 名(优先系统语言本地化名)。

    自实现轻量 sfnt 解析(不依赖 fontTools):
      - .ttc 取第一个子字体的 table 目录
      - 找 'name' 表 → 遍历 NameRecord,挑 nameID=1(family)
      - 平台优先 Windows(platformID=3,UTF-16BE),langID 按系统语言优先
    任何异常 → None(caller fallback 文件名)。
    """
    import struct

    try:
        with open(path, "rb") as fp:
            data = fp.read()
    except OSError:
        return None
    if len(data) < 12:
        return None

    def _font_offset() -> int:
        if data[:4] == b"ttcf":  # TrueType Collection:取第一个子字体偏移
            (num,) = struct.unpack(">I", data[8:12])
            if num >= 1:
                (off,) = struct.unpack(">I", data[12:16])
                return off
        return 0

    try:
        base = _font_offset()
        (num_tables,) = struct.unpack(">H", data[base + 4: base + 6])
        name_off = name_len = 0
        rec = base + 12
        for _ in range(num_tables):
            tag = data[rec: rec + 4]
            if tag == b"name":
                (name_off,) = struct.unpack(">I", data[rec + 8: rec + 12])
                (name_len,) = struct.unpack(">I", data[rec + 12: rec + 16])
                break
            rec += 16
        if not name_off:
            return None

        (count,) = struct.unpack(">H", data[name_off + 2: name_off + 4])
        (str_off,) = struct.unpack(">H", data[name_off + 4: name_off + 6])
        strings_base = name_off + str_off

        prefer = _preferred_lang_ids()
        # 候选:nameID=1(family),按 (平台/语言优先级) 打分挑最佳
        best: Optional[str] = None
        best_score = -1
        rp = name_off + 6
        for _ in range(count):
            plat, enc, lang, nid, slen, soff = struct.unpack(
                ">HHHHHH", data[rp: rp + 12]
            )
            rp += 12
            if nid != 1:  # 只要 family
                continue
            raw = data[strings_base + soff: strings_base + soff + slen]
            try:
                if plat in (0, 3):  # Unicode / Windows → UTF-16BE
                    text = raw.decode("utf-16-be", "ignore").strip()
                elif plat == 1:  # Mac → latin1 近似(中文 Mac 名少见,够兜底)
                    text = raw.decode("latin-1", "ignore").strip()
                else:
                    continue
            except Exception:  # noqa: BLE001
                continue
            if not text:
                continue
            # 打分:Windows 平台 + 命中首选语言分最高
            score = 0
            if plat == 3:
                score += 10
            if lang in prefer:
                score += (len(prefer) - prefer.index(lang)) * 5
            if score > best_score:
                best_score = score
                best = text
        return best
    except Exception:  # noqa: BLE001
        return None


def _font_family(path: str) -> Optional[str]:
    """带 mtime 缓存的字体 family 名。"""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    key = (path, mtime)
    if key in _FONT_FAMILY_CACHE:
        return _FONT_FAMILY_CACHE[key]
    fam = _read_name_table_family(path)
    _FONT_FAMILY_CACHE[key] = fam
    return fam


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
        # 本地已下载 ∪ 已知目录(PIPER_VOICE_LABELS)。已知但未下载的标
        # downloaded=False,前端选中后 preview/synthesize 触发 auto-download
        # (hf-mirror 已就绪)。这样下拉永远不空,而且能选很多音色。
        voices = _list_piper_voices()
    elif provider == "edge":
        # 从上游移植的完整 edge 音色目录(331 个,纯协议联网不需要 key)。
        # 中文音色排前。edge 不需要本地文件,直接全列。
        from chayuan.server.video_generation.edge_voices import EDGE_VOICES
        voices = list(EDGE_VOICES)
    else:  # sherpa
        # 扫 bundled_models/tts/sherpa-onnx/ 子目录返实际可用 voice。
        # 名称规约:目录名即 voice_id;含 model.onnx 视为可用。
        voices = _scan_sherpa_voices()
    return {"provider": provider, "count": len(voices), "items": voices}


@video_generation_router.post(
    "/voices/download", summary="按需下载 piper 音色到本地(显式触发,带成功/失败)",
)
def download_voice(
    body: Dict[str, str] = Body(..., examples=[{"provider": "piper", "voice_name": "en_US-amy-medium"}]),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    """前端选中未下载 piper 音色时调用 — 同步下载 + 返结果,让用户看到进度/失败,
    不再像懒下载那样悄悄回退默认音色。

    edge / sherpa 不走这里:edge 在线无需下载;sherpa 是整模型(走 seed 脚本)。
    """
    provider = (body or {}).get("provider") or "piper"
    name = ((body or {}).get("voice_name") or "").strip()
    if provider != "piper":
        return {"downloaded": True, "skipped": f"{provider} 无需下载"}
    if not name or name.startswith("zh_CN-huayan"):
        # huayan 是默认,通常已 bundled / 已存在;空名直接当成功
        pass
    try:
        from chayuan.server.modality.audio import AudioPipeline
        from chayuan.settings import CHAYUAN_ROOT
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"import 失败: {e}")

    ap = AudioPipeline()
    piper_dir = CHAYUAN_ROOT / "models" / "piper"
    onnx = piper_dir / f"{name}.onnx"
    cfg = piper_dir / f"{name}.onnx.json"

    # 已 bundled 或已下载 → 直接成功
    if ap._find_bundled_piper_voice(name) or (onnx.exists() and cfg.exists()):
        return {"downloaded": True, "voice_name": name, "cached": True}

    ok = False
    try:
        ok = ap._try_download_piper_voice(name, piper_dir)
    except Exception as e:  # noqa: BLE001
        logger.warning("[voices/download] %s 异常: %r", name, e, exc_info=True)
        ok = False
    if ok and onnx.exists() and cfg.exists():
        return {"downloaded": True, "voice_name": name}
    raise HTTPException(
        status_code=502,
        detail={
            "code": "piper_voice_download_failed",
            "voice_name": name,
            "hint": "下载失败 — 网络不通或 hf-mirror 无此 voice。可设 "
                    "CHAYUAN_HF_ENDPOINT 换源,或手动放到 models/piper/。",
        },
    )


def _list_piper_voices() -> List[Dict[str, Any]]:
    """piper 音色下拉 = 本地已下载 ∪ 已知目录(PIPER_VOICE_LABELS)。

    - 本地扫到的 voice:downloaded=True,排前
    - 已知但未下载的:downloaded=False,label 带"(未下载,选中自动拉)"
    每项加 ``downloaded`` bool 字段,前端可选地给未下载项标个云朵图标。
    """
    local = _scan_piper_voices()
    local_ids = {v["id"] for v in local}
    for v in local:
        v["downloaded"] = True
    extra: List[Dict[str, Any]] = []
    for vid, label in PIPER_VOICE_LABELS.items():
        if vid in local_ids:
            continue
        parts = vid.split("-")
        locale = parts[0] if parts else ""
        language = locale.replace("_", "-") if "_" in locale else (locale or "unknown")
        extra.append({
            "id": vid,
            "label": f"{label}(未下载,选中自动拉)",
            "language": language,
            "downloaded": False,
        })
    # 已下载排前;未下载里中文(zh_)优先
    extra.sort(key=lambda x: (not x["id"].startswith("zh_"), x["id"]))
    return local + extra


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
            # 多说话人模型:展开成 <model>#<sid> 每个说话人一条(如 aishell3 174 个)
            n_spk = _sherpa_num_speakers(vd)
            if n_spk and n_spk > 1:
                for sid in range(n_spk):
                    items.append({
                        "id": f"{name}#{sid}",
                        "label": f"{label} · 音色 {sid + 1}",
                        "language": "zh-CN",
                    })
            else:
                items.append({"id": name, "label": label, "language": "zh-CN"})
    return items


def _sherpa_num_speakers(voice_dir: str) -> int:
    """读 sherpa 模型说话人数(多说话人 VITS 才 >1)。

    优先读 model.onnx 旁的 num_speakers(部分模型 meta 单独存);否则用
    AudioPipeline 构建(缓存)的 OfflineTts.num_speakers。任何失败返 1
    (退化成单音色,不阻塞列表)。
    """
    # 1) 旁路文件 num_speakers(若 seed 时写了)
    try:
        meta = os.path.join(voice_dir, "num_speakers")
        if os.path.isfile(meta):
            with open(meta, "r", encoding="utf-8") as f:
                return max(1, int(f.read().strip()))
    except Exception:  # noqa: BLE001
        pass
    # 2) 实例化模型读 num_speakers(AudioPipeline 内部缓存,二次调用不重建)
    try:
        from chayuan.server.modality.audio import AudioPipeline
        import sherpa_onnx  # noqa: F401  确认包在
        ap = AudioPipeline()
        if not hasattr(ap, "_sherpa_tts_cache"):
            ap._sherpa_tts_cache = {}
        tts = ap._sherpa_tts_cache.get(voice_dir)
        if tts is None:
            tts = ap._build_sherpa_tts(sherpa_onnx, voice_dir)
            if tts is not None:
                ap._sherpa_tts_cache[voice_dir] = tts
        return int(getattr(tts, "num_speakers", 1) or 1) if tts is not None else 1
    except Exception as e:  # noqa: BLE001
        logger.debug("[/voices:sherpa] num_speakers 读取失败 %s: %r", voice_dir, e)
        return 1


def _scan_piper_voices() -> List[Dict[str, Any]]:
    """扫描 piper voice 目录,返所有可用 voice(.onnx + .onnx.json 配对存在)。

    扫两档:
      - <CHAYUAN_ROOT>/models/bundled/tts/piper/  HF 仓库嵌套(zh/zh_CN/huayan/medium/*.onnx)
      - <CHAYUAN_ROOT>/models/piper/              user-local 平铺(auto-download 落地点)

    label 优先用 PIPER_VOICE_LABELS 映射(标注男/女/语言),缺则按 voice name
    模板 `{locale}-{speaker}-{quality}` 自动拼。language 从 locale 前缀推断
    (zh_CN → zh-CN)。
    """

    import os as _os
    from pathlib import Path as _Path

    candidates: List[_Path] = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        candidates.append(_Path(str(CHAYUAN_ROOT)) / "models" / "bundled" / "tts" / "piper")
        candidates.append(_Path(str(CHAYUAN_ROOT)) / "models" / "piper")
    except Exception:  # noqa: BLE001
        pass

    seen: set = set()
    items: List[Dict[str, Any]] = []
    for root in candidates:
        try:
            if not root.is_dir():
                continue
            # rglob 兼容 bundled HF 嵌套结构 + user-local 平铺
            for onnx in sorted(root.rglob("*.onnx")):
                cfg = onnx.parent / f"{onnx.name}.json"
                if not cfg.exists():
                    continue
                name = onnx.stem  # 如 zh_CN-huayan-medium
                if name in seen:
                    continue
                seen.add(name)
                parts = name.split("-")
                locale = parts[0] if parts else ""
                language = locale.replace("_", "-") if "_" in locale else (locale or "unknown")
                label = PIPER_VOICE_LABELS.get(name)
                if not label:
                    speaker = parts[1] if len(parts) > 1 else "?"
                    quality = parts[2] if len(parts) > 2 else "?"
                    label = f"{speaker} ({locale}, {quality})"
                items.append({"id": name, "label": label, "language": language})
        except Exception as e:  # noqa: BLE001
            logger.warning("[/voices:piper] 扫 %s 异常: %r", root, e)
    return items


# rhasspy/piper-voices 常见 voice 的人类可读 label(性别/语言/质量级)。
# 命名约定:{locale}-{speaker}-{quality},quality ∈ x_low/low/medium/high。
# 缺映射的 voice 会按 "{speaker} ({locale}, {quality})" 模板自动拼,仍可用。
PIPER_VOICE_LABELS: Dict[str, str] = {
    # 中文
    "zh_CN-huayan-medium":          "huayan · 中文女声(medium)",
    "zh_CN-huayan-x_low":           "huayan · 中文女声(超快 x_low)",
    # 美式英语
    "en_US-amy-medium":             "Amy · 美式英语女声(medium)",
    "en_US-amy-low":                "Amy · 美式英语女声(low)",
    "en_US-ryan-high":              "Ryan · 美式英语男声(high)",
    "en_US-ryan-medium":            "Ryan · 美式英语男声(medium)",
    "en_US-ryan-low":               "Ryan · 美式英语男声(low)",
    "en_US-kathleen-low":           "Kathleen · 美式英语女声(low)",
    "en_US-lessac-medium":          "Lessac · 美式英语男声(medium)",
    "en_US-lessac-high":            "Lessac · 美式英语男声(high)",
    "en_US-lessac-low":             "Lessac · 美式英语男声(low)",
    "en_US-libritts-high":          "LibriTTS · 多说话人合集(2400+,high)",
    "en_US-libritts_r-medium":      "LibriTTS-R · 多说话人合集(medium)",
    "en_US-arctic-medium":          "Arctic · 多说话人(medium)",
    "en_US-hfc_female-medium":      "HFC · 美式英语女声(medium)",
    "en_US-hfc_male-medium":        "HFC · 美式英语男声(medium)",
    "en_US-joe-medium":             "Joe · 美式英语男声(medium)",
    "en_US-kusal-medium":           "Kusal · 美式英语男声(medium)",
    "en_US-l2arctic-medium":        "L2Arctic · 多说话人(medium)",
    "en_US-norman-medium":          "Norman · 美式英语男声(medium)",
    # 英式英语
    "en_GB-alan-medium":            "Alan · 英式英语男声(medium)",
    "en_GB-alan-low":               "Alan · 英式英语男声(low)",
    "en_GB-alba-medium":            "Alba · 英式英语女声(medium)",
    "en_GB-aru-medium":             "Aru · 英式英语男声(medium)",
    "en_GB-cori-medium":            "Cori · 英式英语女声(medium)",
    "en_GB-cori-high":              "Cori · 英式英语女声(high)",
    "en_GB-jenny_dioco-medium":     "Jenny Dioco · 英式英语女声(medium)",
    "en_GB-northern_english_male-medium": "北方英式英语男声(medium)",
    "en_GB-semaine-medium":         "Semaine · 多说话人(medium)",
    "en_GB-southern_english_female-low":  "南方英式英语女声(low)",
    "en_GB-vctk-medium":            "VCTK · 多说话人合集(medium)",
    # 日语
    "ja_JP-test-medium":            "日语(测试 medium)",
    # 韩语
    "ko_KR-kss-medium":             "KSS · 韩语女声(medium)",
    # 法语
    "fr_FR-siwis-medium":           "Siwis · 法语女声(medium)",
    "fr_FR-siwis-low":              "Siwis · 法语女声(low)",
    "fr_FR-tom-medium":             "Tom · 法语男声(medium)",
    "fr_FR-upmc-medium":            "UPMC · 多说话人(medium)",
    # 德语
    "de_DE-thorsten-medium":        "Thorsten · 德语男声(medium)",
    "de_DE-thorsten-high":          "Thorsten · 德语男声(high)",
    "de_DE-thorsten-low":           "Thorsten · 德语男声(low)",
    "de_DE-thorsten_emotional-medium": "Thorsten · 德语男声(情感版 medium)",
    "de_DE-eva_k-x_low":            "Eva K · 德语女声(x_low)",
    "de_DE-karlsson-low":           "Karlsson · 德语男声(low)",
    "de_DE-kerstin-low":            "Kerstin · 德语女声(low)",
    # 西班牙语
    "es_ES-mls_10246-low":          "MLS · 西班牙语男声(low)",
    "es_ES-davefx-medium":          "DaveFX · 西班牙语男声(medium)",
    "es_ES-sharvard-medium":        "SHarvard · 西班牙语女声(medium)",
    "es_MX-ald-medium":             "ALD · 墨西哥西语男声(medium)",
    "es_MX-claude-high":            "Claude · 墨西哥西语男声(high)",
    # 意大利语
    "it_IT-paola-medium":           "Paola · 意大利语女声(medium)",
    "it_IT-riccardo-x_low":         "Riccardo · 意大利语男声(x_low)",
    # 俄语
    "ru_RU-denis-medium":           "Denis · 俄语男声(medium)",
    "ru_RU-dmitri-medium":          "Dmitri · 俄语男声(medium)",
    "ru_RU-irina-medium":           "Irina · 俄语女声(medium)",
    "ru_RU-ruslan-medium":          "Ruslan · 俄语男声(medium)",
    # 葡萄牙语
    "pt_BR-faber-medium":           "Faber · 巴西葡语男声(medium)",
    "pt_PT-tugão-medium":           "Tugão · 葡萄牙葡语男声(medium)",
    # 阿拉伯语
    "ar_JO-kareem-low":             "Kareem · 阿语男声(low)",
    "ar_JO-kareem-medium":          "Kareem · 阿语男声(medium)",
    # 越南语
    "vi_VN-vais1000-medium":        "VAIS1000 · 越南语女声(medium)",
    "vi_VN-25hours_single-low":     "25hours · 越南语女声(low)",
}


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
    "/materials/{material_id}/file",
    summary="素材文件流式(卡片预览 / 下载)— 图/视频/音频",
)
def serve_material_file(
    material_id: str = FPath(...),
    download: bool = Query(False, description="True 强制下载,False 内联预览"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    """按 material_id 流式返回素材文件,前端 <img>/<video>/<audio> 预览用。

    path 来自 DB(非用户输入,无遍历风险),仅校验归属 + 文件存在。
    """
    row = materials_store.get_material(material_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "material not found")
    path = row.get("path") or ""
    if not path or not os.path.isfile(path):
        raise HTTPException(404, f"material file missing on disk: {path}")
    headers: Dict[str, str] = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{os.path.basename(path)}"'
    media_type = row.get("mime") or None
    return FileResponse(path, media_type=media_type, headers=headers)


@video_generation_router.post(
    "/preview-edl", summary="时间轴低清代理预览(仅画面轨拼接)",
)
def preview_edl(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    import hashlib
    import json as _json
    from chayuan.server.video_generation.schemas import Timeline, VideoAspect
    from chayuan.server.video_generation.steps import compose as compose_step
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation._helpers import storage_dir

    raw_tl = body.get("timeline") or {}
    aspect = str(body.get("aspect") or "9:16")
    try:
        timeline = Timeline.model_validate(raw_tl)
        VideoAspect(aspect)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"timeline/aspect 非法: {e}") from e

    cache_dir = storage_dir("preview", create=True)
    key = hashlib.md5(
        (aspect + _json.dumps(raw_tl, sort_keys=True, ensure_ascii=False)).encode("utf-8")
    ).hexdigest()
    out_path = os.path.join(cache_dir, f"proxy-{key}.mp4")

    if not (os.path.isfile(out_path) and os.path.getsize(out_path) > 0):
        def _resolve(source: dict) -> str:
            mid = source.get("material_id")
            if mid:
                try:
                    row = materials_store.get_material(mid)
                except Exception:  # noqa: BLE001
                    row = None
                return (row or {}).get("path") or ""
            url = source.get("url") or ""
            if url.startswith(("http://", "https://")):
                return materials_step.save_video(url, save_dir=cache_dir) or ""
            return source.get("path") or ""

        try:
            compose_step.render_proxy_from_timeline(
                timeline, aspect, out_path, source_resolver=_resolve,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg] preview-edl 失败: %r", e)
            raise HTTPException(502, f"预览渲染失败: {e}") from e

    return FileResponse(out_path, media_type="video/mp4")


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

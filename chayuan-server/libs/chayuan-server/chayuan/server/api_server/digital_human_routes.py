"""数字人 REST —— 薄路由,逻辑在 digital_human/{store,jobs}。"""
from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import Path as FPath
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.video_generation._helpers import dh_avatars_dir, dh_products_dir
from chayuan.server.video_generation.digital_human import engine as dh_engine
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human import online_presence, published_store
from chayuan.server.video_generation.digital_human.schemas import DhGenerateRequest
from chayuan.server.utils import api_address

digital_human_router = APIRouter(prefix="/api/v1/digital-human", tags=["digital-human"])

logger = logging.getLogger("chayuan.digital_human.routes")

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
            subtitle_enabled=bool(body.get("subtitle_enabled", True)),
            subtitle=body.get("subtitle"),
            video_width=int(body.get("video_width", 720) or 720),
            video_height=int(body.get("video_height", 1280) or 1280),
            model=body.get("model", ""),
            ku_ids=body.get("ku_ids") or [],
            allow_model_override=bool(body.get("allow_model_override", True)),
            allow_kb_override=bool(body.get("allow_kb_override", True)),
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


@digital_human_router.get("/products/file")
def product_file(ref: str,
                 user: Dict[str, Any] = Depends(require_auth_enabled())) -> FileResponse:
    """按 product ref 返商品图/视频文件,供工作台画布预览。ref 含冒号 → query 参数。"""
    p = store.resolve_product_path(ref)
    if not p or not os.path.isfile(p):
        raise HTTPException(404, "商品文件不存在")
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


def _format_kb_context(
    res: Dict[str, Any],
) -> "Tuple[str | None, List[Dict[str, Any]]]":
    """从 kb_query 统一响应里取命中,拼成 grounding 上下文块 + 来源清单。

    响应结构:``res["data"]["items"][*]["results"][*]`` 是命中列表。命中按来源
    类型(``source_type``)字段不同:

      - document:有 ``text`` / ``snippet`` 正文,``citation.file_name`` 来源文件。
      - structured:``text`` 由 summary/SQL/结果行拼好(基本不空)。
      - vector:``text`` 取自 payload 的 content,可能为空;空时用 ``metadata``
        (payload)里的键值对兜底拼一段简短文本。

    返回 ``(context, sources)``:

      - ``context``:多段命中文本拼接(总长截到 ~1500 字),全空时为 None
        (让 generate_script 不注入 grounding 头)。
      - ``sources``:每条命中记一条 ``{file_name, snippet, kb_name, kind}``,
        即便该命中没有可读正文(被跳过不进 context)也记一条,便于前端展示
        「依据来源 N 条」并知道这次到底用没用上知识库。
    """
    data = res.get("data") if isinstance(res, dict) else None
    sources: List[Dict[str, Any]] = []
    if not isinstance(data, dict):
        return None, sources
    blocks: List[str] = []
    total = 0
    limit = 1500
    seen = set()
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        for hit in item.get("results") or []:
            if not isinstance(hit, dict):
                continue
            kind = str(hit.get("source_type") or item.get("kind") or "").strip() or "document"
            citation = hit.get("citation") if isinstance(hit.get("citation"), dict) else {}
            # 来源标题:文档取文件名;结构化/向量取来源名 / collection / 表。
            title = str(
                citation.get("file_name")
                or citation.get("source_name")
                or citation.get("collection")
                or citation.get("table")
                or hit.get("kb_name")
                or citation.get("kb_name")
                or ""
            ).strip()
            kb_name = str(hit.get("kb_name") or citation.get("kb_name") or citation.get("source_name") or "").strip()

            text = str(hit.get("text") or hit.get("snippet") or "").strip()
            if not text and kind in ("vector", "structured"):
                # 非文档源 text 可能空:用 payload/metadata 键值对兜底拼简短文本。
                meta = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
                if not meta and isinstance(citation.get("metadata"), dict):
                    meta = citation.get("metadata")
                if isinstance(meta, dict) and meta:
                    pairs = []
                    for k, v in meta.items():
                        if v in (None, "", [], {}):
                            continue
                        pairs.append(f"{k}={v}")
                        if len(pairs) >= 8:
                            break
                    text = ", ".join(pairs).strip()

            # 来源清单始终记一条(含 kind),即便正文为空被跳过也不漏。
            sources.append({
                "file_name": title,
                "snippet": (text[:200] if text else ""),
                "kb_name": kb_name or title,
                "kind": kind,
            })

            if not text or text in seen:
                continue
            seen.add(text)
            piece = f"[{title}] {text}" if title else text
            if total + len(piece) > limit:
                piece = piece[: max(0, limit - total)]
            if not piece:
                continue
            blocks.append(piece)
            total += len(piece)
            if total >= limit:
                break
        if total >= limit:
            break
    context = "\n\n".join(blocks) if blocks else None
    return context, sources


def _retrieve_kb_context(
    user: Dict[str, Any], ku_ids: List[str], query_text: str, *, top_k: int = 5,
) -> "Tuple[str | None, List[Dict[str, Any]]]":
    """按绑定知识源走统一 kb_query 检索，把命中拼成 grounding 上下文 + 来源清单。

    ``/script/generate``（主题）和 ``/script/from-video``（转写稿）共用此逻辑：
    建 Subject + kb_query.search（synthesize 关掉，只要原始命中）+ _format_kb_context。
    ``top_k`` 由调用方透传(默认 5)。ku_ids 空或检索失败时返回 ``(None, [])``
    （让 generate_script 不注入 grounding 头，不阻断文案生成）。
    """
    ku_ids = [str(x) for x in (ku_ids or []) if str(x).strip()]
    if not ku_ids or not (query_text or "").strip():
        return None, []
    try:
        from chayuan.server.kb_query.authz import subject_from_user
        from chayuan.server.kb_query.schemas import (
            QueryContent,
            QueryOptions,
            SearchRequest,
        )
        from chayuan.server.kb_query.service import search as kb_search

        kb_subject = subject_from_user(user)
        req = SearchRequest(
            ku_ids=ku_ids,
            contents=[QueryContent(text=query_text.strip())],
            # 只要原始命中喂 _format_kb_context，丢弃综合 summary，因此关掉
            # 检索后的综合 LLM 调用，避免「检索->综合（白跑）->写文案」三段链路。
            options=QueryOptions(top_k=max(1, int(top_k or 5)), synthesize=False),
        )
        res = kb_search(kb_subject, req)
        return _format_kb_context(res)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] KB grounding 检索失败，降级: %r", e)
        return None, []


@digital_human_router.post("/script/generate")
def script_generate(body: Dict[str, Any],
                    user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """主题 -> LLM 生成口播文案(复用 VG steps/script.generate_script)。

    ``ku_ids`` 非空时,先走统一 kb_query 检索绑定知识库,把命中文本拼成
    grounding 上下文注入 prompt(检索失败降级,不阻断文案生成)。
    """
    from chayuan.server.video_generation.steps.script import (
        VlmCapabilityError,
        generate_script,
    )
    subject_text = (body.get("subject") or "").strip()
    if not subject_text:
        raise HTTPException(422, "缺 subject(主题)")
    product_ref = (body.get("product_ref") or "").strip() or None

    kb_top_k = int(body.get("kb_top_k", 5) or 5)
    _req_ku = [str(x) for x in (body.get("ku_ids") or []) if str(x).strip()]
    kb_context, kb_sources = _retrieve_kb_context(
        user, _req_ku, subject_text, top_k=kb_top_k,
    )
    logger.info("[dh] script/generate ku_ids=%d kb_hits=%d", len(_req_ku), len(kb_sources))

    try:
        text = generate_script(
            subject_text, language=str(body.get("language", "") or ""),
            paragraph_number=int(body.get("paragraphs", 1) or 1),
            model=body.get("model"),
            product_ref=product_ref,
            kb_context=kb_context,
        )
    except VlmCapabilityError as e:
        # 多模态分支判定/调用出所选模型不支持图像 -> 转人话给用户
        raise HTTPException(422, str(e))
    if not text:
        if product_ref:
            raise HTTPException(
                502,
                "图像对话失败,请选支持视觉(VLM)的模型或去模型广场安装",
            )
        raise HTTPException(502, "文案生成失败(LLM 不可用?先在模型配置里设默认 chat 模型)")
    return {
        "script": text,
        "kb_used": bool(kb_sources),
        "sources": kb_sources,
    }


@digital_human_router.post("/script/generate-multi")
def script_generate_multi(body: Dict[str, Any],
                          user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """多角色脚本生成:逐角色检索各自知识源 -> 合成一个多角色 prompt ->
    一次 LLM -> ``[角色名] 台词`` 容错解析成有序 ``role_segments``。

    body: ``preset_id`` / ``subject`` / ``template_id``(可选) / ``product_ref``(可选) /
    ``model``(可选,用户临时选的文案模型;空=用 ``preset.model``=默认)。
    每角色用 ``role.ku_ids or preset.ku_ids`` 检索;有 ``product_ref`` 时复用单篇
    ``script.py`` 的商品图/视频抽帧 -> data URL -> 多模态 VLM 看图逻辑(与
    ``/script/generate`` 对齐),让多角色文案也能"看图说话"。
    返回 ``{role_segments, kb_used, sources}``,sources 每条标 ``role``=角色名。
    """
    from chayuan.server.video_generation.digital_human.multirole import (
        build_multirole_prompt,
        parse_multirole_output,
    )
    from chayuan.server.video_generation.digital_human.script_templates import (
        get_template,
    )
    from chayuan.server.video_generation.steps.script import (
        VlmCapabilityError,
        _invoke_llm_multimodal,
        _product_image_data_urls,
    )

    preset_id = (body.get("preset_id") or "").strip()
    subject_text = (body.get("subject") or "").strip()
    if not preset_id:
        raise HTTPException(422, "缺 preset_id")
    if not subject_text:
        raise HTTPException(422, "缺 subject(主题)")
    product_ref = (body.get("product_ref") or "").strip() or None

    preset = store.get_preset(preset_id)
    if preset is None:
        raise HTTPException(404, "数字人不存在")
    roles = list(getattr(preset, "avatars", None) or [])
    if not roles:
        raise HTTPException(422, "该预设没有角色(avatars 为空)")
    model = (getattr(preset, "model", "") or "") or None
    preset_ku_ids = list(getattr(preset, "ku_ids", None) or [])

    kb_top_k = int(body.get("kb_top_k", 5) or 5)
    all_sources: List[Dict[str, Any]] = []
    role_dicts: List[Dict[str, Any]] = []
    for role in roles:
        eff = list(getattr(role, "ku_ids", None) or []) or preset_ku_ids
        ctx_i, src_i = _retrieve_kb_context(user, eff, subject_text, top_k=kb_top_k)
        role_name = getattr(role, "name", "") or ""
        for s in (src_i or []):
            all_sources.append({**s, "role": role_name})
        role_dicts.append({
            "name": role_name,
            "persona": getattr(role, "persona", "") or "",
            "context": ctx_i or "",
        })

    tpl = get_template((body.get("template_id") or "").strip()) or {}
    paragraph_number = int(body.get("paragraphs", len(roles)) or len(roles))
    prompt = build_multirole_prompt(
        subject_text, role_dicts, tpl.get("sections", []),
        paragraph_number=paragraph_number,
    )

    try:
        from chayuan.server.utils import get_ChatOpenAI, get_default_llm
        from langchain_core.messages import HumanMessage
    except Exception as e:  # noqa: BLE001
        logger.error("[dh] generate-multi 依赖 import 失败: %r", e)
        raise HTTPException(502, "多角色文案生成依赖缺失(检查 langchain 安装)") from e

    # Med4:用户临时选的文案模型优先于 preset.model;都空再走 capability_router。
    eff_model = (body.get("model") or "").strip() or model
    if not eff_model:
        try:
            from chayuan.server.capability_router import resolve_model
            eff_model = resolve_model("chat") or get_default_llm()
        except Exception:  # noqa: BLE001
            eff_model = get_default_llm()
    if not eff_model:
        raise HTTPException(502, "文案生成失败(LLM 不可用?先在模型配置里设默认 chat 模型)")

    # Med3:有商品图/视频时,复用单篇 script.py 的抽帧 -> data URL + 多模态
    # HumanMessage 构造逻辑(VLM 看图);解析不到可用图像则降级纯文本。
    image_data_urls: List[str] = []
    if product_ref:
        try:
            image_data_urls = _product_image_data_urls(product_ref) or []
        except Exception as e:  # noqa: BLE001
            logger.warning("[dh] generate-multi 商品图解析失败,降级纯文本: %r", e)
            image_data_urls = []

    try:
        if image_data_urls:
            # _invoke_llm_multimodal 内部做 best-effort VLM 能力校验 + 构造多模态消息。
            try:
                out = _invoke_llm_multimodal(prompt, image_data_urls, model=eff_model)
            except VlmCapabilityError:
                # 文案=文本脚本:所选模型不支持图像 → 忽略商品图降级纯文字(不报错、不强制 VLM)
                logger.info("[dh] generate-multi 所选模型不支持图像,忽略商品图纯文字生成")
                llm = get_ChatOpenAI(model_name=eff_model, temperature=0.7, streaming=False)
                out = str(llm.invoke([HumanMessage(content=prompt)]).content)
        else:
            llm = get_ChatOpenAI(model_name=eff_model, temperature=0.7, streaming=False)
            out = str(llm.invoke([HumanMessage(content=prompt)]).content)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] generate-multi LLM 调用失败 model=%s: %r", eff_model, e)
        raise HTTPException(502, "多角色文案生成失败(LLM 调用出错,请检查模型配置)") from e

    role_segments = parse_multirole_output(out, [getattr(r, "name", "") or "" for r in roles])
    return {
        "role_segments": role_segments,
        "kb_used": bool(all_sources),
        "sources": all_sources,
    }


@digital_human_router.get("/script/templates")
def script_templates() -> Dict[str, Any]:
    """内置脚本结构模板(只读常量):自由 / 带货四段 / 问题方案。"""
    from chayuan.server.video_generation.digital_human.script_templates import (
        list_templates,
    )
    return {"templates": list_templates()}


@digital_human_router.post("/script/from-video")
async def script_from_video(
    file: UploadFile = File(...),
    model: "str | None" = Form(default=None),
    ku_ids: List[str] = Form(default=[]),
    kb_top_k: int = Form(default=5),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    """参考视频 -> 抽音轨 -> ASR 转写 -> LLM 改写成口播文案。

    与 /script/generate 共用绑定逻辑:ku_ids 非空时先走统一 kb_query 检索拼
    grounding,转写稿当作 subject 喂 generate_script(model=...),让参考视频
    文案同样跟随预设绑定的对话模型与知识库(而非裸调 _invoke_llm)。
    """
    import subprocess, tempfile
    from chayuan.server.modality.audio import AudioPipeline
    from chayuan.server.video_generation.steps.script import generate_script
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
        # 转写稿作为「改写主题」,复用 generate_script(同一套 model + grounding)。
        kb_context, kb_sources = _retrieve_kb_context(
            user, ku_ids, transcript, top_k=int(kb_top_k or 5),
        )
        subject = (
            "下面是一段参考视频的语音转写,请据其主题与风格改写成适合数字人口播朗读的短视频文案。"
            + chr(10) + chr(10) + transcript
        )
        script = (generate_script(
            subject, model=(model or None), kb_context=kb_context,
        ) or "").strip()
        return {
            "script": script or transcript,
            "transcript": transcript,
            "kb_used": bool(kb_sources),
            "sources": kb_sources,
        }
    finally:
        for pth in (tf.name, wav):
            try:
                os.unlink(pth)
            except OSError:
                pass


_PRODUCT_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
_PRODUCT_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv"}


@digital_human_router.post("/products")
async def upload_product(file: UploadFile = File(...),
                         user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """商品资料上传 —— 图片或短视频(VLM 看图/抽帧出带货文案用)。
    保留真实后缀(ref 末段含后缀,后续按后缀判图/视频)。"""
    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    if ext not in _PRODUCT_IMG_EXTS and ext not in _PRODUCT_VIDEO_EXTS:
        raise HTTPException(
            422,
            f"不支持的商品文件类型 {ext}(图片: jpg/jpeg/png/webp/bmp;视频: mp4/mov/webm/mkv)",
        )
    fid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}{ext}"
    dest = os.path.join(dh_products_dir(create=True), fid)
    with open(dest, "wb") as f:
        f.write(await file.read())
    kind = "image" if ext in _PRODUCT_IMG_EXTS else "video"
    return {"ref": f"product:{fid}", "name": fid, "kind": kind}


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
                         matte=body.matte, engine=body.engine,
                         script=body.script, role_scripts=body.role_scripts,
                         role_segments=body.role_segments, script_model=body.script_model,
                         fps=body.fps,
                         bgm_type=body.bgm_type, bgm_file=body.bgm_file, bgm_volume=body.bgm_volume)
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


@digital_human_router.delete("/tasks/{tid}")
def delete_task(tid: str, drop_file: bool = Query(True),
                user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return {"ok": dh_jobs.delete_task(tid, drop_files=drop_file)}


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
        tags=[f"dh_task_{tid}"],
    )
    result_material_id = row.get("material_id")
    materials: List[Dict[str, Any]] = [row]

    # 多形象各段(coframe/sequential)逐个注册成素材,供模式相关多轨建轨;
    # 任一段读盘/注册失败 -> 整体退回单片(segments=[]),不阻断、不 500。
    segments = list(getattr(st, "segments", None) or [])
    seg_with_mid: List[Dict[str, Any]] = []
    try:
        for seg in segments:
            sp = seg.get("path") or ""
            if not sp or not os.path.isfile(sp):
                raise FileNotFoundError(f"段文件缺失: {sp!r}")
            m = materials_store.create_material(
                source="digital_human_role",
                name=os.path.basename(sp),
                path=sp,
                owner_id=owner,
                mime="video/mp4",
                size=os.path.getsize(sp),
                duration_ms=int(seg.get("duration_ms") or 0),
                tags=[f"dh_task_{tid}", f"role_{seg.get('role_index')}"],
            )
            seg_with_mid.append({**seg, "material_id": m.get("material_id")})
            materials.append(m)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] to-timeline 段素材注册失败,退回单片: %r", e)
        seg_with_mid = []
        materials = [row]

    # 取 compose_mode + slots:status 不存,经关联 preset(preset_id)取。
    mode = "single"
    slots: List[Any] = []
    try:
        preset = store.get_preset(getattr(st, "preset_id", "") or "")
        if preset is not None:
            mode = getattr(preset, "compose_mode", "single") or "single"
            slots = list(getattr(preset, "avatars", None) or [])
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] to-timeline 取 preset 失败,按 single 建轨: %r", e)

    # 构建按模式分轨的 Timeline EDL,供 VG 时间轴编辑器加载(改字幕/位置→VG 重渲染)
    from chayuan.server.video_generation.digital_human.timeline_bridge import (
        build_timeline_for_mode,
    )
    dur_ms = 0
    try:
        from chayuan.server.video_generation.steps.subtitle import _probe_audio_duration_ms
        dur_ms = _probe_audio_duration_ms(st.result_path) or 0
    except Exception:  # noqa: BLE001
        dur_ms = 0
    timeline = build_timeline_for_mode(
        mode,
        result_material_id=result_material_id,
        result_path=st.result_path,
        segments=seg_with_mid,
        slots=slots,
        total_ms=dur_ms,
        script=getattr(st, "script", "") or "",
    )
    tl = timeline.model_dump() if hasattr(timeline, "model_dump") else timeline
    return {"materials": materials, "timeline": tl}


class _ResubCue(BaseModel):
    start_ms: int = 0
    end_ms: int = 0
    text: str = ""


class _ResubBody(BaseModel):
    cues: List[_ResubCue] = Field(default_factory=list)
    style: Dict[str, Any] = Field(default_factory=dict)


@digital_human_router.get("/tasks/{tid}/subtitle")
def task_subtitle(tid: str = FPath(..., max_length=64),
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """就地编辑字幕:取该任务的字幕 cue(真实时间)+ 当前样式 + 是否可重渲染。"""
    try:
        return dh_jobs.get_task_subtitle(tid)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(409, str(e))


@digital_human_router.post("/tasks/{tid}/resubtitle")
def task_resubtitle(body: _ResubBody, tid: str = FPath(..., max_length=64),
                    user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """就地编辑字幕重渲染:复用已生成片段只重跑 ffcompose,用编辑后的 cues+样式重烧字幕。"""
    try:
        cues = [c.model_dump() for c in body.cues]
        path = dh_jobs.resubtitle_task(tid, cues, dict(body.style or {}))
        return {"ok": True, "result_path": path}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(409, str(e))


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


# ── 在线数字人:发布 / 列表 / 删除 / 开关(owner 侧,require_auth) ──────────
def _pub_dump(rec) -> Dict[str, Any]:
    """发布记录 → 前端 dict:补 url(基于 public_host)+ 实时在线人数。"""
    d = rec.model_dump()
    d["url"] = f"{api_address(is_public=True)}/dh/{rec.token}"
    d["viewers"] = online_presence.count(rec.token)
    return d


def _uid(user: Dict[str, Any]) -> str:
    return str((user or {}).get("id") or "") if isinstance(user, dict) else ""


@digital_human_router.post("/published")
def publish_preset(body: Dict[str, Any],
                   user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    pid = (body or {}).get("preset_id") or ""
    p = store.get_preset(pid)
    if not p:
        raise HTTPException(404, "预设不存在")
    # 仅单形象可发布:多人同框/分段轮流是多角色对话编排,不适用单形象 idle + 对话的公开页。
    if getattr(p, "compose_mode", "single") != "single":
        raise HTTPException(400, "仅单形象数字人可发布为在线数字人")
    # new=True:一个 preset 发布多个在线数字人(各自独立 token/链接);默认幂等覆盖同 preset。
    rec = published_store.publish(p, owner_id=_uid(user), new=bool((body or {}).get("new")))
    return _pub_dump(rec)


@digital_human_router.get("/published")
def list_published(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    owner = _uid(user)
    items = [_pub_dump(r) for r in published_store.list_published(owner_id=owner or None)]
    return {"count": len(items), "items": items}


@digital_human_router.delete("/published/{token}")
def delete_published(token: str,
                     user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return {"ok": published_store.delete(token)}


@digital_human_router.patch("/published/{token}")
def patch_published(token: str, body: Dict[str, Any],
                    user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    rec = published_store.set_flags(
        token,
        enabled=(body or {}).get("enabled"),
        chat_enabled=(body or {}).get("chat_enabled"),
        matte=(body or {}).get("matte"),
    )
    if not rec:
        raise HTTPException(404, "发布记录不存在")
    return _pub_dump(rec)

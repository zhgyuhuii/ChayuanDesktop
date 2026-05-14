from __future__ import annotations

import asyncio
import base64
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse
from openai import AsyncClient
from sse_starlette.sse import EventSourceResponse, ServerSentEvent

from chayuan.settings import Settings
from chayuan.server.utils import get_config_platforms, get_config_models, get_model_info, get_OpenAIClient
from chayuan.utils import build_logger

from .api_schemas import *

logger = build_logger()


DEFAULT_API_CONCURRENCIES = 5  # 默认单个模型最大并发数
model_semaphores: Dict[
    Tuple[str, str], asyncio.Semaphore
] = {}  # key: (model_name, platform)
openai_router = APIRouter(prefix="/v1", tags=["OpenAI 兼容平台整合接口"])


@asynccontextmanager
async def get_model_client(model_name: str) -> AsyncGenerator[AsyncClient]:
    """
    对重名模型进行调度，依次选择：空闲的模型 -> 当前访问数最少的模型

    77 题:支持 ``platform::model`` 复合 ID 精确路由
    -------------------------------------------------
    如果 client 传入 ``deepseek::deepseek-v4-flash`` 这种格式,server 把它解析成
    ``platform_name=deepseek + model_name=deepseek-v4-flash``,精确选 deepseek
    平台不被 baidu-qianfan 等同名模型覆盖。
    格式说明:
      * ``::`` 是命名空间分隔,model_id 自身可以含 ``/``(如 ``siliconflow/deepseek-r1``)
      * 不含 ``::`` 的旧格式仍走原行为(自动选第一个),向后兼容
    """
    explicit_platform: Optional[str] = None
    if "::" in model_name:
        explicit_platform, model_name = model_name.split("::", 1)
        explicit_platform = explicit_platform.strip() or None
        model_name = model_name.strip()

    max_semaphore = 0
    selected_platform = ""
    selected_model = model_name
    model_infos = get_model_info(
        model_name=model_name,
        platform_name=explicit_platform,  # 77 题:精确路由
        multiple=True,
    )
    if not model_infos:
        available = sorted(get_config_models(model_type="llm").keys())
        detail = (
            f"specified model '{model_name}' cannot be found in MODEL_PLATFORMS. "
            f"Available LLM models: {', '.join(available) if available else '(none)'}"
        )
        if explicit_platform:
            detail = (
                f"specified model '{model_name}' on platform '{explicit_platform}' "
                f"cannot be found in MODEL_PLATFORMS."
            )
        raise HTTPException(status_code=400, detail=detail)

    for m, c in model_infos.items():
        key = (m, c["platform_name"])
        api_concurrencies = c.get("api_concurrencies", DEFAULT_API_CONCURRENCIES)
        if key not in model_semaphores:
            model_semaphores[key] = asyncio.Semaphore(api_concurrencies)
        semaphore = model_semaphores[key]
        if semaphore._value >= api_concurrencies:
            selected_platform = c["platform_name"]
            selected_model = m
            break
        elif semaphore._value > max_semaphore:
            selected_platform = c["platform_name"]
            selected_model = m

    key = (selected_model, selected_platform)
    semaphore = model_semaphores[key]
    platform_info = get_config_platforms().get(selected_platform) or {}
    try:
        await semaphore.acquire()
        yield get_OpenAIClient(platform_name=selected_platform, is_async=True)
    except Exception as e:
        api_base = platform_info.get("api_base_url") or ""
        ptype = str(platform_info.get("platform_type") or "")
        hint = ""
        if ptype == "ollama":
            hint = (
                "。请确认 Ollama 已启动、api_base_url 正确，且模型已拉取:"
                f" ollama list | findstr {selected_model}"
            )
        logger.exception(
            "failed when request to %s api_base=%r platform_type=%r",
            key,
            api_base,
            ptype,
        )
        raise HTTPException(
            status_code=502,
            detail=f"模型请求失败: model={selected_model!r}, platform={selected_platform!r}, "
                   f"api_base={api_base!r}: {type(e).__name__}: {e}{hint}",
        ) from e
    finally:
        semaphore.release()


async def openai_request(
    method, body, extra_json: Dict = {}, header: Iterable = [], tail: Iterable = []
):
    """
    helper function to make openai request with extra fields
    """

    async def generator():
        try:
            for x in header:
                if isinstance(x, str):
                    x = OpenAIChatOutput(content=x, object="chat.completion.chunk")
                elif isinstance(x, dict):
                    x = OpenAIChatOutput.model_validate(x)
                else:
                    raise RuntimeError(f"unsupported value: {header}")
                for k, v in extra_json.items():
                    setattr(x, k, v)
                yield x.model_dump_json()

            async for chunk in await method(**params):
                for k, v in extra_json.items():
                    setattr(chunk, k, v)
                yield chunk.model_dump_json()

            for x in tail:
                if isinstance(x, str):
                    x = OpenAIChatOutput(content=x, object="chat.completion.chunk")
                elif isinstance(x, dict):
                    x = OpenAIChatOutput.model_validate(x)
                else:
                    raise RuntimeError(f"unsupported value: {tail}")
                for k, v in extra_json.items():
                    setattr(x, k, v)
                yield x.model_dump_json()
        except asyncio.exceptions.CancelledError:
            logger.warning("streaming progress has been interrupted by user.")
            return
        except Exception as e:
            logger.error(f"openai request error: {e}")
            yield {"data": json.dumps({"error": str(e)})}

    params = body.model_dump(exclude_unset=True)
    if params.get("max_tokens") == 0:
        params["max_tokens"] = Settings.model_settings.MAX_TOKENS

    if hasattr(body, "stream") and body.stream:
        return EventSourceResponse(generator())
    else:
        result = await method(**params)
        for k, v in extra_json.items():
            setattr(result, k, v)
        return result.model_dump()


def _probe_model_platform(platform_name: str, info: Dict[str, Any]) -> Tuple[bool, List[str], str]:
    ptype = str(info.get("platform_type") or "").lower()
    api_base = str(info.get("api_base_url") or "").strip()
    if not api_base:
        return False, [], "api_base_url 未配置"

    try:
        if ptype == "ollama":
            from chayuan.server.utils import detect_ollama_models

            detected = detect_ollama_models(api_base)
            ids = list(detected.get("llm_models") or [])
        elif ptype == "xinference":
            from chayuan.server.utils import detect_xf_models, get_base_url

            detected = detect_xf_models(get_base_url(api_base))
            ids = list(detected.get("llm_models") or [])
        else:
            import openai  # noqa: WPS433

            client = openai.Client(
                base_url=api_base,
                api_key=info.get("api_key") or "EMPTY",
                timeout=8.0,
            )
            resp = client.models.list()
            ids = [m.id for m in (resp.data or [])]
        return True, ids, ""
    except Exception as e:  # noqa: BLE001
        logger.warning("model platform probe failed: %s %s: %r", platform_name, api_base, e)
        return False, [], f"{type(e).__name__}: {e}"


@openai_router.get("/models")
async def list_models(type: Optional[str] = None, check_access: bool = False) -> Dict:
    """整合所有"已启用厂商 + 已启用模型"的列表(单一真源)。

    73 题修复:之前用 ``get_config_models()`` 的 ``Dict[model_id, info]``,
    跨平台同名模型会**互相覆盖**(如百度千帆和 deepseek 都有 ``deepseek-v4-flash``,
    后遍历到的厂商会替换前者的 entry,导致 deepseek 自己的模型一个不剩)。
    现在直接遍历 ``get_config_platforms()`` 平铺 (platform, type, model_id) 三元组,
    每个组合各占一条,杜绝覆盖。

    - 自动过滤:``platform.enabled=False`` 整个厂商不出现;
      ``platform.disabled_models`` 内的模型名不出现
    - ``auto_detect_model=True`` 的 ollama/xinference 平台,合并 live 拉取的清单
    - 每条结果带 ``platform_name`` + ``model_type``(llm/embed/rerank/...)
    - ``check_access=true`` 时按平台探测一次真实可达性;探测失败或模型不在平台
      返回的列表中时标 ``available=false``,前端选择器会禁用该模型。
    - ``?type=llm`` 只返该类型字段下的模型
    """
    # capability(short) → yaml 字段
    _TYPE_FIELDS = (
        ("llm", "llm_models"),
        ("embed", "embed_models"),
        ("rerank", "rerank_models"),
        ("text2image", "text2image_models"),
        ("image2text", "image2text_models"),
        ("speech2text", "speech2text_models"),
        ("text2speech", "text2speech_models"),
    )

    try:
        platforms = get_config_platforms() or {}
    except Exception:
        logger.exception("get_config_platforms 失败,返回空模型列表")
        platforms = {}

    # 82 题:从 PROVIDER_CATALOG 拿 display_name(中英文友好名),
    # 给前端按 platform_display_name 分组(如"深度求索 DeepSeek")而非裸 pid。
    # lazy import 避免循环依赖。
    _display_name_map: Dict[str, str] = {}
    try:
        from chayuan.server.config_panel.model_config import PROVIDER_CATALOG
        for _meta in PROVIDER_CATALOG:
            if getattr(_meta, "display_name", None):
                _display_name_map[_meta.pid] = _meta.display_name
    except Exception as _e:  # noqa: BLE001
        logger.debug("display_name lookup failed: %r", _e)

    # 处理 ollama/xinference 的 auto_detect — 与 get_config_models 同源逻辑
    # 但**不**做 model_id 全局去重,保留每个 platform 各自的清单
    def _maybe_auto_detect(pname: str, pinfo: Dict[str, Any]) -> Dict[str, List[str]]:
        """返回 ``{field: [model_ids]}``;auto_detect 时合并 live 拉取的清单。"""
        from chayuan.server.utils import detect_ollama_models, detect_xf_models, get_base_url
        out: Dict[str, List[str]] = {}
        for _t, field in _TYPE_FIELDS:
            out[field] = list(pinfo.get(field) or [])

        if not pinfo.get("auto_detect_model"):
            return out

        ptype = str(pinfo.get("platform_type") or "").lower()
        try:
            if ptype == "ollama":
                detected = detect_ollama_models(pinfo.get("api_base_url") or "")
                for field in ("llm_models", "embed_models"):
                    extra = detected.get(field) or []
                    if extra:
                        out[field] = list(dict.fromkeys(out[field] + list(extra)))
            elif ptype == "xinference":
                detected = detect_xf_models(get_base_url(pinfo.get("api_base_url") or ""))
                for field in ("llm_models", "embed_models", "image2text_models",
                              "text2image_models", "rerank_models"):
                    extra = detected.get(field) or []
                    if extra:
                        out[field] = list(dict.fromkeys(out[field] + list(extra)))
        except Exception as e:  # noqa: BLE001
            logger.debug("auto_detect failed for %s (%s): %r", pname, ptype, e)
        return out

    probe_cache: Dict[str, Tuple[bool, List[str], str]] = {}
    data: List[Dict[str, Any]] = []

    for pname, pinfo in platforms.items():
        blacklist = set(pinfo.get("disabled_models") or [])
        fields_models = _maybe_auto_detect(pname, pinfo)

        # 探测一次平台
        probe_result: Optional[Tuple[bool, List[str], str]] = None
        if check_access:
            probe_result = probe_cache.get(pname)
            if probe_result is None:
                probe_result = await asyncio.to_thread(
                    _probe_model_platform, pname, pinfo,
                )
                probe_cache[pname] = probe_result

        for mtype_short, field in _TYPE_FIELDS:
            if type and mtype_short != type:
                continue
            models = fields_models.get(field) or []
            if models == "auto":
                # 旧 yaml 写法 — 已不推荐,提示一次后跳过
                logger.warning(
                    "platform %s.%s = 'auto' 但未启用 auto_detect_model;跳过",
                    pname, field,
                )
                continue
            for m_id in models:
                if not isinstance(m_id, str) or not m_id:
                    continue
                if m_id in blacklist:
                    continue

                available = True
                reason = ""
                if probe_result is not None:
                    platform_ok, detected_ids, probe_reason = probe_result
                    if not platform_ok:
                        available = False
                        reason = probe_reason or "模型平台不可达"
                    elif detected_ids and m_id not in detected_ids:
                        available = False
                        reason = "模型不在平台返回的可用模型列表中"

                data.append({
                    "id": m_id,
                    "object": "model",
                    "owned_by": pname,
                    "platform_name": pname,
                    # 82 题:友好显示名(中英文),如"深度求索 DeepSeek";
                    # 没在 PROVIDER_CATALOG 的厂商(如自定义)fallback 用 pid
                    "platform_display_name": _display_name_map.get(pname) or pname,
                    "model_type": mtype_short,
                    "available": available,
                    "reason": reason,
                })

    # 本地模型注入:对话/向量/重排等已扫描入 local_index 的模型,以独立分组
    # ``platform_name='local'`` / ``platform_display_name='本地模型'`` 出现。
    # 前端 ModelMenuList 按 platform_name 自动分组,无需额外改造。
    # 单条本地模型也保持分组形式(子级是模型 ID),让用户始终看得见来源标识。
    _LOCAL_CAP_TO_TYPE = {
        "chat":            "llm",
        "text-embedding":  "embed",
        "rerank":          "rerank",
        "text-to-image":   "text2image",
        "image-to-text":   "image2text",
        "speech-to-text":  "speech2text",
        "text-to-audio":   "text2speech",
    }
    try:
        from chayuan.server.model_registry.local_index import get_local_index
        idx = get_local_index()
        for entry in idx.list_entries():
            cap_short = _LOCAL_CAP_TO_TYPE.get(entry.capability)
            if cap_short is None:
                continue
            if type and cap_short != type:
                continue
            data.append({
                "id": entry.model_id,
                "object": "model",
                "owned_by": "local",
                "platform_name": "local",
                "platform_display_name": "本地模型",
                "model_type": cap_short,
                "available": True,
                "reason": "",
            })
    except Exception as e:  # noqa: BLE001
        logger.debug("local_index 注入失败,跳过:%r", e)

    # 按 platform_name 排序,同 platform 内按 id 排序,前端分组显示更稳定
    data.sort(key=lambda r: (r.get("platform_name") or "", r.get("id") or ""))
    return {"object": "list", "data": data}


@openai_router.post("/chat/completions")
async def create_chat_completions(
    body: OpenAIChatInput,
):
    async with get_model_client(body.model) as client:
        result = await openai_request(client.chat.completions.create, body)
        return result


@openai_router.post("/completions")
async def create_completions(
    request: Request,
    body: OpenAIChatInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.completions.create, body)


@openai_router.post("/embeddings")
async def create_embeddings(
    request: Request,
    body: OpenAIEmbeddingsInput,
):
    params = body.model_dump(exclude_unset=True)
    client = get_OpenAIClient(model_name=body.model)
    return (await client.embeddings.create(**params)).model_dump()


@openai_router.get("/embeddings/preflight")
async def embeddings_preflight(modality: str = "text") -> Dict[str, Any]:
    """嵌入能力探测 — 前端在上传图像 / 文档前问一下"后端能不能向量化"。

    映射:
      * ``modality=text``  → capability_router("embedding")
      * ``modality=image`` → capability_router("clip")

    返回(对齐 chayuan-client `EmbeddingPreflight`):
      ok=true  → 已配默认模型,可直接走索引
      ok=false → 未配,前端引导用户去设置面板装一个(默认推荐 jina-clip / bge-m3)
    """
    from chayuan.server.capability_router import resolve_model

    if modality not in ("text", "image"):
        raise HTTPException(400, f"unsupported modality: {modality!r}; expected 'text' or 'image'")

    cap_internal = "embedding" if modality == "text" else "clip"
    capability_label = "text-embedding" if modality == "text" else "image-embedding"
    model_id = resolve_model(cap_internal)

    if not model_id:
        # 未配 → 引导 UI 打开设置 → AI 平台 → image-embedding / text-embedding tab
        return {
            "ok": False,
            "modality": modality,
            "capability": capability_label,
            "model": None,
            "runtime": None,
            "setup": {
                "panel": "aiPlatform",
                "endpoint": "/v1/admin/recommended",
                "query": {"capability": capability_label},
                "default": None,
            },
        }

    runtime: Optional[str] = None
    try:
        info = get_model_info(model_id)
        if isinstance(info, dict):
            rt = info.get("platform_name") or info.get("runtime")
            runtime = str(rt) if rt else None
    except Exception:  # noqa: BLE001 — 拿不到 runtime 不影响 preflight 结论
        runtime = None

    return {
        "ok": True,
        "modality": modality,
        "capability": capability_label,
        "model": model_id,
        "runtime": runtime,
    }


@openai_router.post("/images/generations")
async def create_image_generations(
    request: Request,
    body: OpenAIImageGenerationsInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.images.generate, body)


@openai_router.post("/images/variations")
async def create_image_variations(
    request: Request,
    body: OpenAIImageVariationsInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.images.create_variation, body)


@openai_router.post("/images/edit")
async def create_image_edit(
    request: Request,
    body: OpenAIImageEditsInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.images.edit, body)


@openai_router.post("/audio/translations", deprecated="暂不支持")
async def create_audio_translations(
    request: Request,
    body: OpenAIAudioTranslationsInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.audio.translations.create, body)


@openai_router.post("/audio/transcriptions", deprecated="暂不支持")
async def create_audio_transcriptions(
    request: Request,
    body: OpenAIAudioTranscriptionsInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.audio.transcriptions.create, body)


@openai_router.post("/audio/speech", deprecated="暂不支持")
async def create_audio_speech(
    request: Request,
    body: OpenAIAudioSpeechInput,
):
    async with get_model_client(body.model) as client:
        return await openai_request(client.audio.speech.create, body)


def _get_file_id(
    purpose: str,
    created_at: int,
    filename: str,
) -> str:
    today = datetime.fromtimestamp(created_at).strftime("%Y-%m-%d")
    return base64.urlsafe_b64encode(f"{purpose}/{today}/{filename}".encode()).decode()


def _get_file_info(file_id: str) -> Dict:
    splits = base64.urlsafe_b64decode(file_id).decode().split("/")
    created_at = -1
    size = -1
    file_path = _get_file_path(file_id)
    if os.path.isfile(file_path):
        created_at = int(os.path.getmtime(file_path))
        size = os.path.getsize(file_path)

    return {
        "purpose": splits[0],
        "created_at": created_at,
        "filename": splits[2],
        "bytes": size,
    }


def _get_file_path(file_id: str) -> str:
    file_id = base64.urlsafe_b64decode(file_id).decode()
    return os.path.join(Settings.basic_settings.BASE_TEMP_DIR, "openai_files", file_id)


@openai_router.post("/files")
async def files(
    request: Request,
    file: UploadFile,
    purpose: str = "assistants",
) -> Dict:
    created_at = int(datetime.now().timestamp())
    file_id = _get_file_id(
        purpose=purpose, created_at=created_at, filename=file.filename
    )
    file_path = _get_file_path(file_id)
    file_dir = os.path.dirname(file_path)
    os.makedirs(file_dir, exist_ok=True)
    with open(file_path, "wb") as fp:
        shutil.copyfileobj(file.file, fp)
    file.file.close()

    return dict(
        id=file_id,
        filename=file.filename,
        bytes=file.size,
        created_at=created_at,
        object="file",
        purpose=purpose,
        # 方便客户端直接 vision 引用；非 OpenAI 标准字段，但向后兼容
        url=f"/v1/files/{file_id}/content",
    )


@openai_router.get("/files")
def list_files(purpose: str) -> Dict[str, List[Dict]]:
    file_ids = []
    root_path = Path(Settings.basic_settings.BASE_TEMP_DIR) / "openai_files" / purpose
    for dir, sub_dirs, files in os.walk(root_path):
        dir = Path(dir).relative_to(root_path).as_posix()
        for file in files:
            file_id = base64.urlsafe_b64encode(
                f"{purpose}/{dir}/{file}".encode()
            ).decode()
            file_ids.append(file_id)
    return {
        "data": [{**_get_file_info(x), "id": x, "object": "file"} for x in file_ids]
    }


@openai_router.get("/files/{file_id}")
def retrieve_file(file_id: str) -> Dict:
    file_info = _get_file_info(file_id)
    return {**file_info, "id": file_id, "object": "file"}


@openai_router.get("/files/{file_id}/content")
def retrieve_file_content(file_id: str) -> Dict:
    file_path = _get_file_path(file_id)
    return FileResponse(file_path)


@openai_router.delete("/files/{file_id}")
def delete_file(file_id: str) -> Dict:
    file_path = _get_file_path(file_id)
    deleted = False

    try:
        if os.path.isfile(file_path):
            os.remove(file_path)
            deleted = True
    except:
        ...

    return {"id": file_id, "deleted": deleted, "object": "file"}

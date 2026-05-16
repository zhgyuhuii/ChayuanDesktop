"""图像知识源 FastAPI 路由（B 补丁 + 新增 kind=image）。

路径：/knowledge_source/{source_id}/image/*
以及独立的 /image_models/*（模型管理，不绑 source）
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.auth.source_access import can_read, can_write

logger = logging.getLogger("chayuan.api.image")

image_router = APIRouter(prefix="/knowledge_source", tags=["Knowledge Source - Image"])
image_model_router = APIRouter(prefix="/image_models", tags=["Image Models"])


def _get_source_or_404(source_id: int) -> Dict[str, Any]:
    from chayuan.server.db.repository.knowledge_source_repository import get_source
    src = get_source(int(source_id))
    if src is None:
        raise HTTPException(404, "source not found")
    if src.get("kind") != "image":
        raise HTTPException(400, "this endpoint only for kind=image sources")
    return src


def _build_image_connector(source_id: int):
    from chayuan.server.db.repository.knowledge_source_repository import (
        connection_spec_for_source,
    )
    from chayuan.server.image_source.connector import ImageConnector
    resolved = connection_spec_for_source(int(source_id))
    if resolved is None:
        raise HTTPException(400, "image source missing connection")
    _, spec = resolved
    return ImageConnector(spec=spec, source_id=int(source_id))


def _resolve_store_name(source_id: int) -> str:
    """统一 store 名解析,与 ImageConnector 完全同源。"""
    return _build_image_connector(int(source_id)).source_name


# ---------------------------------------------------------------------------
# Upload / list / delete
# ---------------------------------------------------------------------------

@image_router.post("/{source_id}/image/upload", summary="上传图像到知识源并入索引")
async def upload_image_endpoint(
    source_id: int,
    files: List[UploadFile] = File(...),
    tags: str = Form(""),
    user=Depends(require_auth_enabled()),
):
    if not can_write(user, int(source_id)):
        raise HTTPException(403, "no write permission")
    _get_source_or_404(int(source_id))
    conn = _build_image_connector(int(source_id))
    added: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    # 持久化到图片目录：CHAYUAN_ROOT/data/images/{source_id}/
    from chayuan.server.image_source.store import _image_indexes_root
    img_dir = _image_indexes_root() / f"{int(source_id)}_files"
    img_dir.mkdir(parents=True, exist_ok=True)
    try:
        from chayuan.server.file_storage import NS, get_storage
        storage = get_storage()
    except Exception:  # noqa: BLE001
        storage = None

    # 上传循环。新策略(用户诉求"即使图像嵌入模型不能用 也要能够上传图像"):
    #   1. 文件**总是**先落盘(用户的图必须保住)
    #   2. 再尝试入向量索引;embedder 缺失/失败时:
    #      - 不阻断 — image 仍记录到 added,只是 ``image_id=None``,
    #        ``vector_status="missing"``
    #      - 收集 missing 信号,响应 ``code=0`` 但 ``warning`` 字段提示用户装模型
    #   3. 老的 422 只在用户**显式要求**入向量(以后加 ?require_vector=true 时)
    embedder_missing = False
    embedder_missing_reason = ""
    for f in files:
        data = await f.read()
        fname = os.path.basename(f.filename or "upload.bin")
        import hashlib
        md5 = hashlib.md5(data).hexdigest()[:8]
        out = img_dir / f"{md5}_{fname}"
        # ---- 第 1 步:文件落盘(永不失败地保住用户的图) ----
        try:
            out.write_bytes(data)
        except Exception as e:  # noqa: BLE001
            logger.warning("upload_image 落盘失败 %s: %r", fname, e)
            errors.append({"filename": fname, "error": f"落盘失败: {e}"})
            continue
        # 同步到统一存储(失败不影响主流程)
        if storage is not None:
            try:
                storage.put(
                    NS.IMAGE_FILES,
                    f"{int(source_id)}/{md5}_{fname}",
                    data, content_type=f.content_type or "image/jpeg",
                )
            except Exception as _e:  # noqa: BLE001
                logger.debug("image_files 存储同步失败(忽略):%r", _e)
        # ---- 第 2 步:尝试入向量索引(允许失败) ----
        try:
            image_id = conn.add_image(str(out), tags=tags or "")
            added.append({
                "filename": fname, "image_id": image_id,
                "path": str(out), "vector_status": "indexed",
            })
        except Exception as e:  # noqa: BLE001
            if _looks_like_missing_embedder(e):
                embedder_missing = True
                embedder_missing_reason = embedder_missing_reason or str(e)
                logger.warning(
                    "upload_image %s 落盘成功但向量化失败(embedder 缺失): %r",
                    fname, e,
                )
                # 仍算上传成功,只是没向量
                added.append({
                    "filename": fname, "image_id": None,
                    "path": str(out), "vector_status": "missing",
                    "vector_error": str(e)[:200],
                })
            else:
                logger.warning("upload_image %s 向量化失败(其它原因): %r", fname, e)
                added.append({
                    "filename": fname, "image_id": None,
                    "path": str(out), "vector_status": "error",
                    "vector_error": str(e)[:200],
                })

    payload: Dict[str, Any] = {"code": 0, "data": {"added": added, "errors": errors}}
    if embedder_missing:
        suggested = _suggest_image_embedder()
        payload["warning"] = {
            "code": "image_embedder_missing",
            "message": (
                "图像已上传保存,但向量化失败(图像嵌入模型不可用),"
                "暂不能做以图搜图 / 文搜图。装好模型后可重建索引。"
            ),
            "reason": embedder_missing_reason[:200],
            "suggested_model": suggested["repo"],
            "suggested_capability": suggested["capability"],
            "suggested_runtime": suggested["runtime"],
            "marketplace_deeplink": suggested.get("marketplace_deeplink", ""),
        }
    return payload


def _looks_like_missing_embedder(e: Exception) -> bool:
    """判断错误是否为"图像 embedder 不可用"。

    匹配关键字:
        * ``embedder``  / ``encode_image``
        * ``transformers`` / ``torch`` 缺失
        * ``model files``  not found
        * ``huggingface_hub`` 加载错
    """
    msg = (str(e) or "").lower()
    keys = (
        "embedder", "encode_image", "no module named 'transformers'",
        "no module named 'torch'", "siglip", "clip-vit",
        "open_clip", "weights_only", "snapshot_download",
        "could not load",
    )
    return any(k in msg for k in keys)


def _suggest_image_embedder() -> Dict[str, str]:
    """返回当前默认图像 embedder 的推荐安装信息。

    优先级:
      1. capability_defaults.clip(89-5 真源)
      2. ``Settings.kb_settings.IMAGE_EMBEDDER``(老兼容)
      3. 内置推荐 ``jinaai/jina-clip-v1``(89 设计:Infinity 主推,跨模态)

    runtime 默认 ``infinity``(89-13 后 Infinity 是真源)。
    """
    repo = ""
    try:
        from chayuan.server.image_source.embedder import resolve_default
        repo, _plat = resolve_default()
    except Exception:  # noqa: BLE001
        pass
    if not repo:
        try:
            from chayuan.settings import Settings  # type: ignore
            repo = (getattr(Settings.kb_settings, "IMAGE_EMBEDDER", "") or "").strip()
        except Exception:  # noqa: BLE001
            repo = ""
    repo = repo or "jinaai/jina-clip-v1"
    return {
        "repo": repo,
        "capability": "image-embedding",
        "runtime": "infinity",
        # 89-11:前端用这个 deeplink 直接跳到模型广场预筛选好的页面
        "marketplace_deeplink": (
            "/admin#/model-settings/marketplace?"
            f"capability=image-embedding&model={repo}&runtime=infinity"
        ),
    }


@image_router.get("/{source_id}/image/list", summary="列出图像索引条目")
def list_images_endpoint(
    source_id: int, limit: int = Query(200),
    user=Depends(require_auth_enabled()),
):
    if not can_read(user, int(source_id)):
        raise HTTPException(403, "no read permission")
    _get_source_or_404(int(source_id))
    from chayuan.server.image_source.store import get_store
    store = get_store(_resolve_store_name(source_id))
    items = []
    for m in store._meta[-int(limit):]:  # 简单取最近 limit 条
        items.append({
            "id": m.get("id"), "path": m.get("path"),
            "size_bytes": m.get("size_bytes"), "md5": m.get("md5"),
            "tags": m.get("tags") or "",
            "embedder_model": m.get("embedder_model"),
            "created_at": m.get("created_at"),
        })
    return {"code": 0, "data": {"count": store.count(), "dim": store.dim(), "items": items}}


@image_router.delete("/{source_id}/image/{image_id}", summary="从索引删除图像")
def delete_image_endpoint(
    source_id: int, image_id: str,
    user=Depends(require_auth_enabled()),
):
    if not can_write(user, int(source_id)):
        raise HTTPException(403, "no write permission")
    _get_source_or_404(int(source_id))
    from chayuan.server.image_source.store import get_store
    ok = get_store(_resolve_store_name(source_id)).remove(image_id)
    return {"code": 0 if ok else 1, "msg": "ok" if ok else "not found"}


@image_router.get("/{source_id}/image/{image_id}", summary="下载/预览图像文件")
def image_file_endpoint(
    source_id: int, image_id: str,
    download: bool = Query(False),
    user=Depends(require_auth_enabled()),
):
    if not can_read(user, int(source_id)):
        raise HTTPException(403, "no read permission")
    _get_source_or_404(int(source_id))
    from chayuan.server.image_source.store import get_store
    store = get_store(_resolve_store_name(source_id))
    rec = next((m for m in store._meta if m.get("id") == image_id), None)
    if rec is None:
        raise HTTPException(404, "image not found")
    local_path = rec.get("path") or ""
    fname = os.path.basename(local_path) if local_path else image_id

    # N 补丁：minio 后端优先走预签名 302；local 本地缺失时从 storage 拉回
    try:
        from chayuan.server.file_storage import NS, get_storage
        from fastapi.responses import RedirectResponse
        storage = get_storage()
        key = f"{int(source_id)}/{fname}"
        if storage.name == "minio" and storage.exists(NS.IMAGE_FILES, key):
            return RedirectResponse(storage.presigned_url(NS.IMAGE_FILES, key, expires_sec=3600))
        if local_path and not os.path.isfile(local_path) and storage.exists(NS.IMAGE_FILES, key):
            storage.copy_to_local(NS.IMAGE_FILES, key, local_path)
    except Exception:  # noqa: BLE001
        pass

    if not local_path or not os.path.isfile(local_path):
        raise HTTPException(404, "image file missing")
    return FileResponse(
        local_path,
        filename=fname if download else None,
        media_type=None,
    )


# ---------------------------------------------------------------------------
# 以图搜图
# ---------------------------------------------------------------------------

@image_router.post("/{source_id}/image/search_by_image", summary="以图搜图")
async def search_by_image_endpoint(
    source_id: int,
    file: UploadFile = File(...),
    top_k: int = Form(5),
    user=Depends(require_auth_enabled()),
):
    if not can_read(user, int(source_id)):
        raise HTTPException(403, "no read permission")
    _get_source_or_404(int(source_id))
    conn = _build_image_connector(int(source_id))
    try:
        data = await file.read()
        # 丢到临时文件传给 PIL.Image
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tf:
            tf.write(data)
            tmp_path = tf.name
        try:
            chunks = conn.search_by_image(tmp_path, top_k=int(top_k))
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"search_by_image 失败：{e}")
    return {"code": 0, "data": [c.to_wire() for c in chunks]}


# ---------------------------------------------------------------------------
# 图像模型管理（全局，不绑 source）
# ---------------------------------------------------------------------------

@image_model_router.get("/", summary="列出支持的图像模型（含磁盘缓存/依赖/测试三态 + 能力）")
def list_image_models_endpoint(
    ready: bool = Query(
        False,
        description="True=仅返回严格就绪（依赖OK+已缓存+已通过smoke测试）的模型，用于KB下拉",
    ),
    crossmodal_only: bool = Query(
        False,
        description="配合 ready=true 使用：仅返回跨模态模型（text+image 同空间）。"
                    "默认 False 保持兼容；KB 文本查图场景建议传 True。",
    ),
    user=Depends(require_auth_enabled()),
):
    """统一入口——UI / KB 下拉共用。

    - ``ready=false``：面板列表，覆盖所有支持模型 + 三态信息 + capabilities（供"下载/测试/删除"按钮）
    - ``ready=true``：仅严格就绪模型
    - ``ready=true, crossmodal_only=true``：仅跨模态就绪模型（KB 文本查图下拉专用）
    """
    from chayuan.server.image_source.model_registry import (
        list_models_for_ui, list_ready_models,
    )
    if ready:
        data = list_ready_models(crossmodal_only=crossmodal_only)
    else:
        data = list_models_for_ui()
    return {"code": 0, "data": data}


@image_model_router.post("/{model_name:path}/smoke_test",
                         summary="对已下载模型做 smoke 测试（加载+小图 embed）")
def smoke_test_image_model_endpoint(
    model_name: str,
    sync: bool = Query(True, description="False=提交异步任务（首次加载耗时）"),
    user=Depends(require_auth_enabled()),
):
    role = user.get("role") if isinstance(user, dict) else ""
    if role != "admin" and user is not None:
        raise HTTPException(403, "admin only")
    from chayuan.server.shared.jobs import async_enabled, submit_job
    if not sync and async_enabled():
        task_id, status = submit_job(
            "image_model_smoke_test", {"model_name": model_name},
        )
        return {"code": 0, "data": {"task_id": task_id, "status": status}}
    from chayuan.server.image_source.model_manager import smoke_test_model
    ret = smoke_test_model(model_name)
    return {
        "code": 0 if ret.get("ok") else 1,
        "msg": ret.get("error") or ret.get("msg") or "ok",
        "data": ret,
    }


@image_model_router.post("/download", summary="从 HuggingFace Hub 下载模型（同步/长耗时，建议 Arq 异步）")
def download_image_model_endpoint(
    model_name: str = Body(..., embed=True),
    sync: bool = Body(False, embed=True, description="True=同步下载；False=提交异步任务"),
    user=Depends(require_auth_enabled()),
):
    # 仅 admin 可下载（节省带宽）
    role = user.get("role") if isinstance(user, dict) else ""
    if role != "admin" and user is not None:
        raise HTTPException(403, "admin only")
    from chayuan.server.shared.jobs import async_enabled, submit_job
    if not sync and async_enabled():
        task_id, status = submit_job("image_model_download", {"model_name": model_name})
        return {"code": 0, "data": {"task_id": task_id, "status": status}}
    from chayuan.server.image_source.model_manager import download_model
    ret = download_model(model_name)
    return {"code": 0 if ret.get("ok") else 1,
            "msg": ret.get("error") or "ok", "data": ret}


@image_model_router.post("/upload_bundle", summary="用户上传模型 zip/tar.gz 离线安装")
async def upload_model_bundle_endpoint(
    model_name: str = Form(...),
    bundle: UploadFile = File(...),
    user=Depends(require_auth_enabled()),
):
    role = user.get("role") if isinstance(user, dict) else ""
    if role != "admin" and user is not None:
        raise HTTPException(403, "admin only")
    # 临时文件保存
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(bundle.filename or "")[1] or ".zip") as tf:
        data = await bundle.read()
        tf.write(data)
        tmp_path = tf.name
    try:
        from chayuan.server.image_source.model_manager import upload_model_bundle
        ret = upload_model_bundle(model_name=model_name, bundle_path=tmp_path)
        return {"code": 0 if ret.get("ok") else 1,
                "msg": ret.get("error") or "ok", "data": ret}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:  # noqa: BLE001
            pass


@image_model_router.delete("/{model_name:path}", summary="删除已缓存的模型")
def delete_image_model_endpoint(
    model_name: str, user=Depends(require_auth_enabled()),
):
    role = user.get("role") if isinstance(user, dict) else ""
    if role != "admin" and user is not None:
        raise HTTPException(403, "admin only")
    from chayuan.server.image_source.model_manager import delete_model
    ret = delete_model(model_name)
    return {"code": 0 if ret.get("ok") else 1, "msg": ret.get("error") or ret.get("msg", "ok")}


@image_model_router.get("/disk_usage", summary="模型缓存磁盘占用总览")
def disk_usage_endpoint(user=Depends(require_auth_enabled())):
    from chayuan.server.image_source.model_manager import disk_usage_summary
    return {"code": 0, "data": disk_usage_summary()}


# ---------------------------------------------------------------------------
# 89-6:GET /image_models/runtime_status
# 模型广场 + ④ tab 共用的"实时运行状态"查询。
#
# 内容:
#   * default_model_id  / default_platform   ← embedder.resolve_default()
#   * client_in_use     / client_healthy     ← 当前生效 client 类型 + 探活
#   * infinity_loaded[] ← 扫 <CHAYUAN_ROOT>/compose/infinity.yaml 的 MODEL_ID
#                          + docker compose ps state
#   * hf_cache_present[] ← 扫 ~/.cache/huggingface/hub
#
# 5 秒 LRU,避免每次刷卡片都 docker exec / yaml IO。
# ---------------------------------------------------------------------------

import time as _time_mod
from threading import Lock as _Lock

_RUNTIME_CACHE: Dict[str, Any] = {}
_RUNTIME_CACHE_LOCK = _Lock()
_RUNTIME_CACHE_TTL = 5.0


def _scan_infinity_loaded() -> List[Dict[str, Any]]:
    """读 compose/infinity.yaml MODEL_ID env + docker compose ps,返回已上线模型。"""
    out: List[Dict[str, Any]] = []
    try:
        from chayuan.server.config_panel.compose_manager import (
            get_compose_file_for_service,
        )
        yaml_p = get_compose_file_for_service("infinity")
    except Exception:  # noqa: BLE001
        yaml_p = None
    if not yaml_p:
        return out

    # 解析 yaml 拿 MODEL_ID
    model_id = ""
    try:
        import yaml  # type: ignore
        with open(yaml_p, "r", encoding="utf-8") as f:
            doc = yaml.safe_load(f) or {}
        env = (doc.get("services") or {}).get("infinity", {}).get("environment") or []
        if isinstance(env, list):
            for item in env:
                s = str(item)
                if s.startswith("MODEL_ID="):
                    model_id = s.split("=", 1)[1].strip()
                    break
        elif isinstance(env, dict):
            model_id = str(env.get("MODEL_ID") or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.debug("scan infinity yaml failed: %r", e)

    if not model_id:
        return out

    # 探活:走 _docker_compose_ps;running 才算 loaded
    try:
        from chayuan.server.config_panel.runtime_framework_panel import (
            _docker_compose_ps,
        )
        state, _url = _docker_compose_ps("infinity")
        if state == "running":
            out.append({"model_id": model_id})
    except Exception as e:  # noqa: BLE001
        logger.debug("docker ps infinity failed: %r", e)
    return out


def _scan_hf_cache_present() -> List[str]:
    """扫 ~/.cache/huggingface/hub 列出所有 ``models--*``。

    转 ``models--owner--repo`` → ``owner/repo`` 形式。
    """
    import re as _re
    out: List[str] = []
    cache_root = Path(
        os.environ.get(
            "HF_HOME",
            str(Path.home() / ".cache" / "huggingface"),
        )
    ) / "hub"
    if not cache_root.exists():
        return out
    try:
        for p in cache_root.iterdir():
            name = p.name
            if not name.startswith("models--"):
                continue
            # models--owner--repo[--sub]
            stripped = name[len("models--"):]
            owner_repo = stripped.replace("--", "/", 1)
            out.append(owner_repo)
    except Exception as e:  # noqa: BLE001
        logger.debug("scan hf cache failed: %r", e)
    return out


@image_model_router.get(
    "/runtime_status",
    summary="89-6:图像嵌入运行时状态(模型广场 / ④ tab 共用)",
)
def image_models_runtime_status(user=Depends(require_auth_enabled())):
    """返回当前默认 / client 类型 / Infinity 已加载 / hf-cache 命中。

    5 秒 LRU 缓存,避免每次刷卡片都 docker exec。
    """
    now = _time_mod.time()
    with _RUNTIME_CACHE_LOCK:
        cached = _RUNTIME_CACHE.get("payload")
        ts = _RUNTIME_CACHE.get("ts", 0.0)
        if cached and now - ts < _RUNTIME_CACHE_TTL:
            return {"code": 0, "data": cached}

    # 1) resolve_default
    try:
        from chayuan.server.image_source.embedder import resolve_default
        default_model_id, default_platform = resolve_default()
    except Exception as e:  # noqa: BLE001
        logger.warning("resolve_default failed: %r", e)
        default_model_id, default_platform = "", None

    # 2) client_in_use + healthy(不强制实例化,只判断 platform 推断 + 主动探活)
    client_in_use = ""
    client_healthy = False
    try:
        from chayuan.server.image_source.embedder import get_client
        cli = get_client()
        client_in_use = cli.kind
        client_healthy = bool(cli.healthcheck())
    except Exception as e:  # noqa: BLE001
        logger.debug("get_client probe failed: %r", e)
        client_in_use = ""
        client_healthy = False

    # 3) infinity_loaded
    infinity_loaded = _scan_infinity_loaded()

    # 4) hf_cache_present
    hf_cache_present = _scan_hf_cache_present()

    payload = {
        "default_model_id": default_model_id,
        "default_platform": default_platform,
        "client_in_use": client_in_use,
        "client_healthy": client_healthy,
        "infinity_loaded": infinity_loaded,
        "hf_cache_present": hf_cache_present,
        "fetched_at": int(now),
    }
    with _RUNTIME_CACHE_LOCK:
        _RUNTIME_CACHE["payload"] = payload
        _RUNTIME_CACHE["ts"] = now
    return {"code": 0, "data": payload}


def _invalidate_runtime_status_cache() -> None:
    """配置变更后(89-9 挂载 / ④ tab 切换)立即清掉 5s 缓存。"""
    with _RUNTIME_CACHE_LOCK:
        _RUNTIME_CACHE.clear()


# ---------------------------------------------------------------------------
# 89-9:POST /image_models/mount_to_infinity
# 把模型 id 写进 infinity.yaml 的 MODEL_ID env,异步执行 docker compose up -d
# 重起 Infinity 容器使其加载该模型。
# ---------------------------------------------------------------------------

def _write_infinity_model_id(model_id: str) -> Path:
    """把 MODEL_ID 写入 infinity.yaml,返回 yaml 路径。

    最小改动原则:只改 ``services.infinity.environment`` 里的 MODEL_ID 行,
    不动其它字段(image / ports / volumes 等)。
    """
    from chayuan.server.config_panel.compose_manager import (
        get_compose_file_for_service,
    )
    yaml_p = get_compose_file_for_service("infinity")
    if yaml_p is None or not yaml_p.exists():
        raise HTTPException(404, "infinity.yaml not found")

    import yaml as _yaml  # type: ignore
    with open(yaml_p, "r", encoding="utf-8") as f:
        doc = _yaml.safe_load(f) or {}
    svc = (doc.get("services") or {}).get("infinity") or {}
    env = svc.get("environment")

    if isinstance(env, list):
        new_env = []
        replaced = False
        for item in env:
            s = str(item)
            if s.startswith("MODEL_ID="):
                new_env.append(f"MODEL_ID={model_id}")
                replaced = True
            else:
                new_env.append(item)
        if not replaced:
            new_env.append(f"MODEL_ID={model_id}")
        svc["environment"] = new_env
    elif isinstance(env, dict):
        env["MODEL_ID"] = model_id
        svc["environment"] = env
    else:
        svc["environment"] = [f"MODEL_ID={model_id}"]

    doc.setdefault("services", {})["infinity"] = svc

    # 写回(原子写)
    tmp = yaml_p.with_suffix(yaml_p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        _yaml.safe_dump(doc, f, allow_unicode=True, sort_keys=False)
    os.replace(tmp, yaml_p)
    return yaml_p


def _kick_infinity_restart_async(yaml_p: Path) -> None:
    """启动一个后台线程跑 ``docker compose -f <yaml> up -d --wait infinity``。"""
    import subprocess
    import threading

    def _run():
        try:
            subprocess.run(
                ["docker", "compose", "-f", str(yaml_p),
                 "up", "-d", "--wait", "infinity"],
                check=False, timeout=180,
                capture_output=True,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("infinity restart failed: %r", e)
        finally:
            # 重启后清缓存,让 UI 立刻看到新状态
            try:
                _invalidate_runtime_status_cache()
                from chayuan.server.image_source.embedder import (
                    _invalidate_client_cache,
                )
                _invalidate_client_cache(None)
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=_run, name="mount-infinity", daemon=True).start()


@image_model_router.get(
    "/local_infinity_pip/status",
    summary="93-1:本地 pip Infinity 当前状态",
)
def local_infinity_pip_status_endpoint(
    user=Depends(require_auth_enabled()),
):
    from chayuan.server.config_panel.local_infinity_pip import (
        get_local_infinity_status,
    )
    st = get_local_infinity_status(probe_port=True)
    return {"code": 0, "data": st.to_dict()}


@image_model_router.post(
    "/local_infinity_pip/start",
    summary="93-4:后台启动本地 pip Infinity 子进程",
)
def local_infinity_pip_start_endpoint(
    payload: Dict[str, Any] = Body(...),
    user=Depends(require_auth_enabled()),
):
    """需 admin 或 guest(AUTH_REQUIRED=false)。"""
    role = user.get("role") if isinstance(user, dict) else ""
    is_guest = bool(user.get("is_guest")) if isinstance(user, dict) else False
    if role != "admin" and not is_guest and user is not None:
        raise HTTPException(403, "admin only")
    model_id = str(payload.get("model_id") or "").strip()
    if not model_id:
        raise HTTPException(400, "model_id required")
    port = payload.get("port")
    try:
        port_n = int(port) if port else None
    except (TypeError, ValueError):
        port_n = None
    from chayuan.server.config_panel.local_infinity_pip import (
        start_local_infinity_subprocess,
    )
    ret = start_local_infinity_subprocess(model_id, port=port_n)
    return {
        "code": 0 if ret["ok"] else 1,
        "data": ret,
        "msg": ret["msg"],
    }


@image_model_router.post(
    "/mount_to_infinity",
    summary="89-9:把模型挂到 Infinity(写 yaml + 重起容器)",
)
def mount_to_infinity_endpoint(
    payload: Dict[str, Any] = Body(...),
    user=Depends(require_auth_enabled()),
):
    """把 ``model_id`` 写到 infinity.yaml 的 MODEL_ID,异步重起容器。

    需 admin 角色(改 yaml + 重启容器是 high-impact 动作)。
    """
    role = user.get("role") if isinstance(user, dict) else ""
    if role != "admin" and user is not None:
        # AUTH_REQUIRED=false 时 user 是 GUEST_USER dict,允许;
        # 其它情况限管理员
        is_guest = bool(user.get("is_guest")) if isinstance(user, dict) else False
        if not is_guest:
            raise HTTPException(403, "admin only")
    model_id = str(payload.get("model_id") or "").strip()
    if not model_id:
        raise HTTPException(400, "model_id required")
    try:
        yaml_p = _write_infinity_model_id(model_id)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("mount_to_infinity write yaml failed")
        raise HTTPException(500, f"write infinity.yaml failed: {e}")

    _kick_infinity_restart_async(yaml_p)

    import uuid as _uuid
    return {
        "code": 0,
        "data": {
            "task_id": f"mount-{_uuid.uuid4().hex[:8]}",
            "estimated_seconds": 30,
            "yaml_path": str(yaml_p),
            "model_id": model_id,
        },
        "msg": "ok",
    }

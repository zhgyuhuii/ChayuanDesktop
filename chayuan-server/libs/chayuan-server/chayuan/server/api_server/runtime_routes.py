"""运行时编排 HTTP API（``/runtime/*``）。

为前端"系统服务面板"与 ``chayuan service info`` CLI 提供同源数据：

* ``GET  /runtime/services``        所有受管服务 endpoint + 凭据（默认掩码）
* ``GET  /runtime/services/{name}`` 单个服务详情
* ``POST /runtime/services/recheck`` 重新走一遍 PortAllocator + endpoint 落库
* ``GET  /runtime/vendor``          扫描 vendor/ 目录
* ``POST /runtime/models/scan``     强制扫描本地模型目录
* ``GET  /runtime/models``          返回当前 local_index 的所有条目
* ``GET  /runtime/models/events``   SSE：本地模型增/改/删事件流（前端模型广场实时刷新）

所有写接口需要管理员权限（沿用 ``require_admin`` 依赖）；只读接口默认放行
（鉴权由全局 ``AuthMiddleware`` 控制；后端开发时 ``AUTH_REQUIRED=false``
不需要 token，生产开启后由 middleware 兜底）。
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from chayuan.server.model_registry.local_index import (
    LocalModelEntry,
    ScanDelta,  # noqa: F401  保留类型，供 _on_change 签名使用
    get_local_index,
    scan_once,
)


# watcher 包已在单机版重构中删除（原"全网模型目录"链路的一部分）。
# 这里保留 SSE 事件流接口，但仅推送 model.snapshot；后续如需实时增量，
# 单机版改用 file watchdog 直接订阅 local_index 目录变更即可。
def start_default_watcher() -> None:  # type: ignore[misc]
    """No-op stub。watcher 已移除；前端可手动触发 ``POST /runtime/models/scan``。"""
    return None


def subscribe(_callback) -> "callable":  # type: ignore[misc]
    """No-op stub。返回的 unsubscribe 也是 no-op。"""
    def _unsub() -> None:
        return None
    return _unsub
from chayuan.server.runtime import (
    allocate_core_ports,
    discover_vendor,
    get_runtime_info,
    known_runtimes,
    known_services,
)

logger = logging.getLogger("chayuan.api.runtime")

runtime_router = APIRouter(prefix="/runtime", tags=["Runtime / Services / Models"])


def _ep_to_payload(ep, *, reveal: bool) -> Dict[str, Any]:
    if ep is None:
        return {}
    return dict(ep) if reveal else dict(ep.masked())


def _entry_to_payload(e: LocalModelEntry) -> Dict[str, Any]:
    return e.to_dict()


# ---------------------------------------------------------------------------
# /runtime/services
# ---------------------------------------------------------------------------

@runtime_router.get("/services", summary="列出所有受管服务的运行时端点 + 凭据（默认密码掩码）")
async def list_services(reveal: bool = Query(False, description="reveal=true 返回明文密码（仅管理员）")) -> Dict[str, Any]:
    ri = get_runtime_info()
    out: List[Dict[str, Any]] = [_ep_to_payload(e, reveal=reveal) for e in ri.list_endpoints()]
    return {
        "code": 0,
        "data": {
            "updated_at": ri._data.get("updated_at"),  # noqa: SLF001 - 内部协议固定
            "services": out,
            "warning": (
                "返回字段已对密码做 **** 掩码；如需明文请加 ?reveal=true 并在生产环境慎用。"
                if not reveal else "已返回明文密码，请勿外发。"
            ),
        },
    }


@runtime_router.get("/services/{name}", summary="单个受管服务的端点详情")
async def get_service(name: str, reveal: bool = Query(False)) -> Dict[str, Any]:
    ri = get_runtime_info()
    ep = ri.get_endpoint(name)
    if ep is None:
        raise HTTPException(404, f"service not found: {name}")
    return {"code": 0, "data": _ep_to_payload(ep, reveal=reveal)}


@runtime_router.post("/services/recheck", summary="重新分配 API/配置面板端口（端口被占自动 bump）")
async def recheck_services() -> Dict[str, Any]:
    try:
        result = allocate_core_ports()
    except Exception as e:  # noqa: BLE001
        logger.exception("recheck_services failed")
        raise HTTPException(500, f"allocate_core_ports failed: {e}") from e
    return {"code": 0, "data": result.to_dict()}


# ---------------------------------------------------------------------------
# /runtime/vendor
# ---------------------------------------------------------------------------

@runtime_router.get("/vendor", summary="扫描 <CHAYUAN_ROOT>/vendor 与仓库 vendor/ 目录")
async def list_vendor() -> Dict[str, Any]:
    layout = discover_vendor()
    return {
        "code": 0,
        "data": {
            **layout.to_dict(),
            "known_services": known_services(),
            "known_runtimes": known_runtimes(),
        },
    }


# ---------------------------------------------------------------------------
# /runtime/models
# ---------------------------------------------------------------------------

@runtime_router.get("/models", summary="本地磁盘模型索引（local_models.json 的内存视图）")
async def list_local_models(
    capability: Optional[str] = Query(None, description="按 capability 过滤；支持 chat/text-embedding/...")
) -> Dict[str, Any]:
    idx = get_local_index()
    items = idx.list_entries()
    if capability:
        items = [e for e in items if e.capability == capability]
    return {
        "code": 0,
        "data": {
            "total": len(items),
            "items": [_entry_to_payload(e) for e in items],
        },
    }


@runtime_router.post("/models/scan", summary="强制扫描本地模型目录，返回新增/更新/删除差异")
async def trigger_scan() -> Dict[str, Any]:
    delta = scan_once()
    # 同时唤起 watcher（如果还没启动）
    try:
        start_default_watcher()
    except Exception as e:  # noqa: BLE001
        logger.debug("start_default_watcher noop: %s", e)
    return {
        "code": 0,
        "data": {
            "added":   [_entry_to_payload(e) for e in delta.added],
            "updated": [_entry_to_payload(e) for e in delta.updated],
            "removed": list(delta.removed),
        },
    }


@runtime_router.get(
    "/models/events",
    summary="SSE：本地模型变化事件流，前端模型广场可订阅以实时刷新",
)
async def models_events_stream(request: Request):
    """`text/event-stream` 长连接；服务侧通过 :func:`subscribe` 推送 ``ScanDelta``。

    与 SSE 客户端契约：
      - 每条事件 ``event: model.changed``，``data: {"added":[...], ...}``；
      - 每 25s 一条 ``event: ping`` 心跳，避免 nginx 60s 空闲断流。
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=128)
    loop = asyncio.get_event_loop()

    def _on_change(delta: ScanDelta) -> None:
        payload = {
            "added":   [_entry_to_payload(e) for e in delta.added],
            "updated": [_entry_to_payload(e) for e in delta.updated],
            "removed": list(delta.removed),
            "ts": int(time.time()),
        }
        try:
            loop.call_soon_threadsafe(queue.put_nowait, payload)
        except RuntimeError:
            # 客户端已断开，事件循环没了；忽略
            pass

    unsubscribe = subscribe(_on_change)
    # 确保 watcher 已经在跑
    try:
        start_default_watcher()
    except Exception as e:  # noqa: BLE001
        logger.debug("start_default_watcher noop: %s", e)

    async def _gen():
        try:
            # 立刻吐一条全量初始快照，避免前端首次连接拿不到东西
            idx = get_local_index()
            yield {
                "event": "model.snapshot",
                "data": json.dumps(
                    {"items": [_entry_to_payload(e) for e in idx.list_entries()]},
                    ensure_ascii=False,
                ),
            }
            last_ping = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=5.0)
                    yield {
                        "event": "model.changed",
                        "data": json.dumps(payload, ensure_ascii=False),
                    }
                except asyncio.TimeoutError:
                    pass
                if time.monotonic() - last_ping > 25.0:
                    yield {"event": "ping", "data": str(int(time.time()))}
                    last_ping = time.monotonic()
        finally:
            unsubscribe()

    return EventSourceResponse(_gen())


# ---------------------------------------------------------------------------
# /runtime/models/import
# ---------------------------------------------------------------------------

@runtime_router.post(
    "/models/import",
    summary="把本地任意路径上的目录或单文件软链接进 <CHAYUAN_ROOT>/models/custom/，并立即扫描入库",
)
async def import_local_model(
    path: str = Body(..., embed=True, description="要导入的本地路径"),
    name: Optional[str] = Body(None, embed=True, description="可选别名；默认取目录/文件名"),
) -> Dict[str, Any]:
    import os
    import shutil
    from pathlib import Path

    src = Path(path).expanduser()
    if not src.exists():
        raise HTTPException(400, f"路径不存在：{src}")
    from chayuan.settings import CHAYUAN_ROOT
    target_root = Path(CHAYUAN_ROOT) / "models" / "custom"
    target_root.mkdir(parents=True, exist_ok=True)

    target_name = (name or src.name).strip()
    target = target_root / target_name
    if target.exists():
        raise HTTPException(409, f"目标已存在：{target}（请改名或先删除）")

    # 优先用符号链接（不占额外磁盘）；不支持符号链接的 OS / 文件系统时退化为复制
    try:
        os.symlink(src, target)
        action = "symlink"
    except (OSError, NotImplementedError):
        if src.is_dir():
            shutil.copytree(src, target)
        else:
            shutil.copy2(src, target)
        action = "copy"

    # 立即扫描，让前端马上能看到
    delta = scan_once()
    return {
        "code": 0,
        "data": {
            "action": action,
            "target": str(target),
            "scan_delta_added": len(delta.added),
        },
    }


# ---------------------------------------------------------------------------
# /runtime/services/{name}/install — 一键安装可选服务
# ---------------------------------------------------------------------------

# 支持一键安装的服务白名单。
# Key 是服务名(supervisor.yaml 里的服务键),value 是 docker image。
# 增加新服务只需加一行,不必改路由。单机版默认无可安装服务,保留路由供未来扩展。
_INSTALLABLE_SERVICES: Dict[str, Dict[str, str]] = {}


@runtime_router.post(
    "/services/{name}/install",
    summary="一键安装可选服务 (docker pull + 写 supervisor override)",
)
async def install_service(name: str) -> Any:
    """流式输出 docker pull 进度。

    返回 SSE 事件流,每行 JSON:
        {"stage": "pull" | "compose" | "ready" | "error", "line": "...", "progress": 0-100?}

    成功后会在 ``<CHAYUAN_ROOT>/supervisor.local.override.yaml`` 中追加该服务,
    用户手动 ``chayuan service start <name>`` 即可启动。
    """
    if name not in _INSTALLABLE_SERVICES:
        raise HTTPException(400, f"该服务不支持一键安装: {name}")

    spec = _INSTALLABLE_SERVICES[name]

    async def _emit() -> Any:
        import shutil as _sh
        from chayuan.settings import CHAYUAN_ROOT

        docker_bin = _sh.which("docker")
        if not docker_bin:
            yield {
                "event": "message",
                "data": json.dumps({
                    "stage": "error",
                    "line": "未找到 docker;请先安装 Docker Desktop / Engine",
                    "fix": "https://docs.docker.com/engine/install/",
                }),
            }
            return

        # 1) docker pull (流式)
        proc = await asyncio.create_subprocess_exec(
            docker_bin, "pull", spec["image"],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip()
            yield {
                "event": "message",
                "data": json.dumps({"stage": "pull", "line": line}),
            }
        rc = await proc.wait()
        if rc != 0:
            yield {
                "event": "message",
                "data": json.dumps({
                    "stage": "error",
                    "line": f"docker pull 失败: rc={rc}",
                }),
            }
            return

        # 2) 写 supervisor.local.override.yaml
        try:
            override_path = _write_supervisor_override(name, spec, CHAYUAN_ROOT)
            yield {
                "event": "message",
                "data": json.dumps({
                    "stage": "compose",
                    "line": f"已写入 {override_path}",
                }),
            }
        except Exception as e:  # noqa: BLE001
            logger.exception("write supervisor override failed")
            yield {
                "event": "message",
                "data": json.dumps({
                    "stage": "error",
                    "line": f"写 supervisor override 失败: {e}",
                }),
            }
            return

        # 3) 完成
        yield {
            "event": "message",
            "data": json.dumps({
                "stage": "ready",
                "line": (
                    f"{name} 已就绪;"
                    f"运行 `chayuan service start {name}` 启动 (端口 "
                    f"{spec['preferred_host_port']})"
                ),
            }),
        }

    return EventSourceResponse(_emit())


def _write_supervisor_override(name: str, spec: Dict[str, str], chayuan_root: str) -> str:
    """把 ``name`` 服务写到 ``supervisor.local.override.yaml``。

    用 minimal yaml 拼接,不引 PyYAML 强依赖(顶层已用 yaml,但避免在该路径
    再 import 一次)。
    """
    import os as _os
    from pathlib import Path as _Path

    override_path = _Path(chayuan_root) / "supervisor.local.override.yaml"
    existing = override_path.read_text(encoding="utf-8") if override_path.exists() else ""

    # 已存在该服务条目则跳过(等用户主动改 yaml)
    if f"\n{name}:" in existing or existing.startswith(f"{name}:"):
        return str(override_path)

    block = (
        f"# auto-generated by /runtime/services/{name}/install\n"
        f"{name}:\n"
        f"  kind: docker\n"
        f"  image: {spec['image']}\n"
        f"  ports:\n"
        f"    - host: ${{CHAYUAN_RUNTIME_{name.upper()}_PORT:-{spec['preferred_host_port']}}}\n"
        f"      container: {spec['container_port']}\n"
        f"  volumes:\n"
        f"    - source: ${{CHAYUAN_DATA}}/vendor-data/{name}/data\n"
        f"      target: {spec['vol_data']}\n"
        f"    - source: ${{CHAYUAN_DATA}}/vendor-data/{name}/log\n"
        f"      target: {spec['vol_log']}\n"
        f"  preferred_port: {spec['preferred_host_port']}\n"
    )
    new_content = (existing.rstrip() + "\n\n" + block) if existing else block
    override_path.parent.mkdir(parents=True, exist_ok=True)
    override_path.write_text(new_content, encoding="utf-8")
    try:
        _os.chmod(override_path, 0o600)
    except OSError:
        pass
    return str(override_path)


# ───────────────────────── /runtime/llama/* ─────────────────────────
# 本地 LLM runtime (llama-server.exe) 控制面。详见
# docs/superpowers/specs/2026-05-15-local-llm-runtime-integration-design.md §4.3。


def _llama_manager():
    """惰性 import 避免循环依赖"""
    from chayuan.server.model_registry.local_runtime import get_manager
    return get_manager()


def _ok(data) -> Dict[str, Any]:
    return {"code": 0, "data": data}


@runtime_router.get("/llama/status")
def llama_status() -> Dict[str, Any]:
    return _ok(_llama_manager().status.to_dict())


@runtime_router.post("/llama/start")
async def llama_start(body: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    model_id = body.get("model_id") if isinstance(body, dict) else None
    status = await _llama_manager().start(model_id=model_id)
    return _ok(status.to_dict())


@runtime_router.post("/llama/stop")
async def llama_stop() -> Dict[str, Any]:
    await _llama_manager().stop()
    return _ok(_llama_manager().status.to_dict())


@runtime_router.post("/llama/restart")
async def llama_restart(body: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    model_id = body.get("model_id") if isinstance(body, dict) else None
    status = await _llama_manager().restart(model_id=model_id)
    return _ok(status.to_dict())


@runtime_router.get("/llama/config")
def llama_config_get() -> Dict[str, Any]:
    import dataclasses as _dc
    return _ok(_dc.asdict(_llama_manager().settings))


@runtime_router.post("/llama/config")
def llama_config_post(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """部分更新设置。不立即重启,需要 /runtime/llama/restart 让端口 / API key 生效"""
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="body 必须是非空 dict")
    # 端口合法性校验:类型 + 范围
    if "port" in body and body["port"] is not None:
        try:
            port_int = int(body["port"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="port 必须是整数")
        if not (1024 <= port_int <= 65535):
            raise HTTPException(status_code=422, detail="port 必须在 1024-65535")
    new_settings = _llama_manager().set_config(body)
    import dataclasses as _dc
    return _ok(_dc.asdict(new_settings))


@runtime_router.get("/llama/install-info")
def llama_install_info() -> Dict[str, Any]:
    """透出关键路径给设置页"模型存放路径" section 显示。

    新字段(2026-05-16):
      - ``is_lite_build``  当前安装包是否轻量版(installer 没嵌全部 cap)
      - ``bundled_caps``   随包嵌入的 capability 短名列表(空 = 全空 / 即 lite 模式
                           但用户后续手动补装过)
      - ``missing_caps``   FULL_CAPS - bundled_caps,前端可据此提示"需先下载"
    """
    from pathlib import Path
    m = _llama_manager()
    exe = m.find_llama_server_exe()  # 受 _INSTALL_SERVICES_DIRS monkeypatch 影响,测试可注入
    version = None
    if exe is not None and exe.parent.is_dir():
        v_path = exe.parent / "VERSION"
        if v_path.is_file():
            version = v_path.read_text(encoding="utf-8").splitlines()[0].strip()

    # lite/full 判定:扫 bundled_models 根目录的 cap 子目录;
    # 出现 chat/image 子目录 = full build。lite 也允许后续用户手动补装,届时跟 full 视觉等同。
    bundled_root = m.chayuan_root / "models" / "bundled"
    # 兼容 Tauri install_dir/bundled_models/(packaging 阶段拷过来的随包模型)
    alt_roots: List[Path] = []
    try:
        from chayuan.server.model_registry.local_runtime import _default_install_services_dirs
        for svc_dir in _default_install_services_dirs():
            alt_roots.append(svc_dir.parent / "bundled_models")
    except Exception:  # noqa: BLE001
        pass

    bundled_caps: List[str] = []
    for root in [bundled_root] + alt_roots:
        if not root.is_dir():
            continue
        for entry in root.iterdir():
            if entry.is_dir() and not entry.name.startswith(".") and entry.name not in bundled_caps:
                # 只算非空目录(.gitkeep 不算真有模型)
                if any(p.is_file() and p.name != ".gitkeep" for p in entry.rglob("*")):
                    bundled_caps.append(entry.name)

    # 单一真源:packaging/bundle_manifest.py
    full_caps: tuple = ()
    try:
        import sys as _sys
        from pathlib import Path as _P
        pkg = _P(__file__).resolve().parents[3] / "packaging"
        _sys.path.insert(0, str(pkg))
        try:
            from bundle_manifest import FULL_CAPS as _FULL  # type: ignore[import-not-found]
            full_caps = tuple(_FULL)
        finally:
            _sys.path.pop(0)
    except Exception:  # noqa: BLE001
        # 兜底:6 项硬编码,避免老 checkout 缺 bundle_manifest 时整接口炸
        full_caps = ("chat", "embedding", "rerank", "asr", "ocr", "image")

    missing = [c for c in full_caps if c not in bundled_caps]
    # is_lite_build:严格定义为「不嵌 chat」(chat 是大头);
    # 即使用户后续手装了 chat 也保留 is_lite_build=true 直观告知"原始 installer 是 lite"
    # —— 但有 chat 嵌入即视为 full(用户拿到的就是 full installer 或他主动等价)。
    is_lite_build = "chat" not in bundled_caps

    return _ok({
        "chayuan_root": str(m.chayuan_root),
        "models_root": str(m.chayuan_root / "models"),
        "bundled_models_root": str(m.chayuan_root / "models" / "bundled"),
        "llama_server_exe": str(exe) if exe else None,
        "build_version": version,
        "is_lite_build": is_lite_build,
        "bundled_caps": bundled_caps,
        "missing_caps": missing,
    })


@runtime_router.get("/diagnose")
def runtime_diagnose() -> Dict[str, Any]:
    """跑所有本地 runtime 健康检查,返报告 JSON。"""
    from chayuan.server.diagnose import run_all_checks
    report = run_all_checks()
    return _ok(report.to_dict())


# ─────── /runtime/llama/{capability}/* — Plan 3B 多 capability ───────

_VALID_CAPABILITIES = {"chat", "embedding", "rerank", "asr", "image-embedding"}


def _validate_capability(capability: str) -> None:
    if capability not in _VALID_CAPABILITIES:
        raise HTTPException(status_code=400, detail=f"unknown capability: {capability!r}")


def _llama_registry():
    """惰性 import 避免循环依赖"""
    from chayuan.server.model_registry.local_runtime_registry import get_registry
    return get_registry()


@runtime_router.get("/llama/registry")
def llama_registry_status() -> Dict[str, Any]:
    """一次拿 3 个 capability 状态;前端 LocalRuntimePanel mount 用。"""
    reg = _llama_registry()
    return _ok({cap: st.to_dict() for cap, st in reg.all_statuses().items()})


@runtime_router.get("/llama/{capability}/status")
def llama_capability_status(capability: str) -> Dict[str, Any]:
    _validate_capability(capability)
    return _ok(_llama_registry().get(capability).status.to_dict())


@runtime_router.post("/llama/{capability}/start")
async def llama_capability_start(
    capability: str, body: Dict[str, Any] = Body(default={})
) -> Dict[str, Any]:
    _validate_capability(capability)
    model_id = body.get("model_id") if isinstance(body, dict) else None
    status = await _llama_registry().get(capability).start(model_id=model_id)
    return _ok(status.to_dict())


@runtime_router.post("/llama/{capability}/stop")
async def llama_capability_stop(capability: str) -> Dict[str, Any]:
    _validate_capability(capability)
    mgr = _llama_registry().get(capability)
    await mgr.stop()
    return _ok(mgr.status.to_dict())


@runtime_router.post("/llama/{capability}/restart")
async def llama_capability_restart(
    capability: str, body: Dict[str, Any] = Body(default={})
) -> Dict[str, Any]:
    _validate_capability(capability)
    model_id = body.get("model_id") if isinstance(body, dict) else None
    status = await _llama_registry().get(capability).restart(model_id=model_id)
    return _ok(status.to_dict())


# ─────────────────────── OCR 健康检查 ───────────────────────


@runtime_router.get("/ocr/health", summary="OCR (RapidOCR) 健康检查")
def ocr_health() -> Dict[str, Any]:
    """OCR 不是独立 sidecar(无端口),onnxruntime 在 chayuan-server 进程内。

    检查项:
      1. RapidOCR python 包是否可 import
      2. ``vendor/bundled_models/ocr/RapidOCR/`` 下 det/rec/cls 三件套 ONNX 是否齐全
    任何一项缺失返回 state=failed + reason,前端 footer 灯亮红。
    """
    from pathlib import Path

    state = "ready"
    reason: Optional[str] = None
    detail: Dict[str, Any] = {}

    # 1) python 包
    try:
        import rapidocr_onnxruntime as _rapidocr  # noqa: F401
        detail["rapidocr_pkg"] = "ok"
    except Exception as e:  # noqa: BLE001
        state = "failed"
        reason = f"rapidocr_onnxruntime 不可 import: {e}"
        detail["rapidocr_pkg"] = "missing"

    # 2) bundled model 三件套(找一个候选路径就算 OK,跟 install-bundled-models 落点对齐)
    if state == "ready":
        try:
            from chayuan.server.model_registry.local_runtime import _default_install_services_dirs
            # services 目录的父级就是 vendor 根
            candidates: List[Path] = []
            for svc_dir in _default_install_services_dirs():
                if not svc_dir or not isinstance(svc_dir, Path):
                    continue
                vendor_root = svc_dir.parent  # services/ 的父级
                candidates.append(vendor_root / "bundled_models" / "ocr" / "RapidOCR")
            needed = [
                "PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
                "PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
                "PP-OCRv3/ch_ppocr_mobile_v2.0_cls_train.onnx",
            ]
            hit_dir: Optional[Path] = None
            for c in candidates:
                if all((c / rel).is_file() for rel in needed):
                    hit_dir = c
                    break
            if hit_dir is None:
                state = "failed"
                reason = "OCR 模型 ONNX 缺失;运行 scripts/install-bundled-models.{ps1,sh} -Only ocr"
                detail["models"] = "missing"
                detail["scanned"] = [str(c) for c in candidates]
            else:
                detail["models"] = "ok"
                detail["models_dir"] = str(hit_dir)
        except Exception as e:  # noqa: BLE001
            state = "failed"
            reason = f"模型路径探测失败: {e}"

    return _ok({"state": state, "reason": reason, "detail": detail})


__all__ = ["runtime_router"]

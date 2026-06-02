"""卸载本地已安装模型(P2 Task 2.3)。

删盘 + 重扫 local_index + 把模型移出 ``local-<cap>`` 平台 enabled 清单,并守住
三条边界:**内置只读** / **正在使用**(非 force 拒) / **找不到**。

解析策略
========
``(source, repo_id)`` 来自前端模型广场卡片(Hub source + owner/repo)。本机落盘
目录名是 ``owner--name``(``install_model._repo_safe_name``)。**不反推拼路径**,
而是查 local_index:
  1. 优先匹配 manifest origin 记录(由 ``installed`` 模块同款逻辑)—— 但 entry
     本身不带 origin,故主用目录名匹配:entry.path 末段 == ``repo_id.replace("/","--")``;
  2. 返回该 entry 的**真实 path**(entry.path),不自行拼 ``<root>/models/...``。

sidecar 联动
============
local_runtime 已有真接口:
  * ``get_registry().get(runtime_cap)`` → SidecarRuntimeManager;``.status`` 含
    ``state`` / ``model_id`` / ``endpoint``(当前在跑的模型)。
  * ``SidecarRuntimeManager.stop()`` (async) —— stop 时内部 ``_deregister_local_platform``
    把 ``local-<cap>`` enabled=False。
  * ``local_runtime._register_local_platform`` —— 重注册,model_list 从
    ``_list_downloaded_models``(读 local_index)重建,删后重扫即自动排除。
故 ③⑥ 为真实接入(非降级):删的是在跑模型 → stop sidecar(deregister);
删的不是在跑模型且 sidecar 仍 ready → 重注册刷新 model_list。
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("chayuan.model_registry.uninstall")


def _safe_name(repo_id: str) -> str:
    """``owner/name`` → ``owner--name``(与 install_model._repo_safe_name 一致)。"""
    return repo_id.replace("/", "--")


def resolve_model_dir(source: str, repo_id: str) -> Optional[Path]:
    """查 local_index 找 ``(source, repo_id)`` 对应的本地模型目录真实 path。

    匹配:entry.path 的末段目录名 == ``repo_id.replace("/","--")``(落盘约定),
    或 == ``repo_id``(单段名 / 已是安全名)。命中返回 entry 的真实 path
    (``Path(entry.path)``),**不反推拼路径**。找不到返回 ``None``。
    """
    try:
        from chayuan.server.model_registry.local_index import get_local_index
        idx = get_local_index()
    except Exception as e:  # noqa: BLE001
        logger.warning("[uninstall] 无法取 local_index: %r", e)
        return None

    want = {_safe_name(repo_id), repo_id}
    for entry in idx.list_entries():
        try:
            p = Path(entry.path)
        except (TypeError, ValueError):
            continue
        # 单文件模型(gguf/onnx)entry.path 指向文件 → 看其父目录名;
        # 目录模型 entry.path 指向目录 → 看其自身末段名。
        candidates = {p.name}
        if p.parent is not None:
            candidates.add(p.parent.name)
        if want & candidates:
            return p
    return None


def _entry_for_path(path: Path):
    """按真实 path 反查 local_index entry(拿 source_tag / capability / size)。"""
    try:
        from chayuan.server.model_registry.local_index import get_local_index
        idx = get_local_index()
    except Exception:  # noqa: BLE001
        return None
    target = str(path.resolve()) if path else ""
    for e in idx.list_entries():
        try:
            if str(Path(e.path).resolve()) == target:
                return e
        except (OSError, TypeError, ValueError):
            if str(e.path) == str(path):
                return e
    return None


def is_bundled_readonly(entry) -> bool:
    """内置(装机自带)模型只读,不允许卸载。

    判定依据是 **entry.relpath 是否以 ``bundled/`` 开头**,而非 source_tag。
    原因:bundled 模型被 ``seed_bundled_models`` 拷到
    ``<CHAYUAN_ROOT>/models/bundled/`` 后,经顶层 ``models`` 根扫到,真实
    ``source_tag`` 是 ``"models"``,bundled 身份只体现在 relpath 前缀
    (见 local_index._candidate_roots 注释)。

    兼容性:接受 entry 对象(读 relpath),也兼容直接传 str(当作 relpath
    判,且冗余兼容历史 ``"bundled"`` source_tag)。
    """
    if isinstance(entry, str):
        return entry.startswith("bundled/") or entry == "bundled"
    relpath = getattr(entry, "relpath", "") or ""
    if relpath.startswith("bundled/"):
        return True
    # 冗余兜底:历史/异常数据若真带 source_tag=="bundled" 也拒卸。
    return getattr(entry, "source_tag", "") == "bundled"


# catalog cap(local_index.capability)→ LocalRuntimeRegistry 运行时短名。
# 与 install_model._CAP_TO_RUNTIME 一致;不在表里的 cap 没有 llama/whisper sidecar。
_CAP_TO_RUNTIME = {
    "chat": "chat",
    "text-embedding": "embedding",
    "rerank": "rerank",
    "speech-to-text": "asr",
    "image-embedding": "image-embedding",
}


def _dir_size_bytes(d: Path) -> int:
    total = 0
    try:
        for p in d.rglob("*"):
            try:
                if p.is_file():
                    total += p.stat().st_size
            except OSError:
                continue
    except OSError:
        pass
    return total


def uninstall(source: str, repo_id: str, *, force: bool = False) -> Dict[str, Any]:
    """卸载一个本地模型。

    步骤:
      ① 解析目录,找不到 → ``{"ok":False,"reason":"not_found"}``;
      ② entry.source_tag=='bundled' → ``{"ok":False,"reason":"bundled"}``(拒);
      ③ 该模型正被某 cap 的 local-runtime 加载(``status.model_id`` 匹配)→
         非 force 返 ``{"ok":False,"reason":"in_use","capability":cap}``;
         force 则先 stop 该 sidecar(deregister)再继续;
      ④ 记 freed_bytes → ``shutil.rmtree``;
      ⑤ ``local_index.scan_once(persist=True)``;
      ⑥ 刷新 ``local-<cap>`` enabled 清单(stop 已 deregister,或仍 ready 时重注册);
      ⑦ 返回 ``{"ok":True,"freed_bytes":...}``。
    """
    model_dir = resolve_model_dir(source, repo_id)
    if model_dir is None or not model_dir.exists():
        return {"ok": False, "reason": "not_found"}

    entry = _entry_for_path(model_dir)
    catalog_cap = getattr(entry, "capability", "") if entry else ""
    entry_model_id = getattr(entry, "model_id", None) if entry else None

    # ② 内置只读(按 entry.relpath 前缀 bundled/ 判,非 source_tag)
    if entry is not None and is_bundled_readonly(entry):
        return {"ok": False, "reason": "bundled"}

    # ③ 在用检查(真实接口:status.model_id)
    runtime_cap = _CAP_TO_RUNTIME.get(catalog_cap)
    in_use_cap = None
    mgr = None
    if runtime_cap and entry_model_id:
        try:
            from chayuan.server.model_registry.local_runtime_registry import get_registry
            mgr = get_registry().get(runtime_cap)
            st = mgr.status
            if getattr(st, "state", None) in ("ready", "starting") and \
                    getattr(st, "model_id", None) == entry_model_id:
                in_use_cap = runtime_cap
        except Exception as e:  # noqa: BLE001 — 查不到状态不阻塞,按未在用处理
            logger.warning("[uninstall] 查 runtime 状态失败(按未在用继续): %r", e)
            mgr = None

    if in_use_cap and not force:
        return {"ok": False, "reason": "in_use", "capability": in_use_cap}

    if in_use_cap and force:
        # force:先停 sidecar(stop 内部 deregister 把 local-<cap> enabled=False)
        try:
            import asyncio
            asyncio.run(mgr.stop())
            logger.info("[uninstall] force 停止 sidecar cap=%s", in_use_cap)
        except Exception as e:  # noqa: BLE001 — 停不下来仍继续删盘
            logger.warning("[uninstall] force stop sidecar 失败(继续删盘): %r", e)

    # ④ 删盘(rmtree 前先量大小;删失败不半删 → 返 error)
    # 单文件模型(gguf/onnx)的 entry.path 指向文件,rmtree 对文件抛
    # NotADirectoryError → 删其所在目录(install_model 单文件也是落在独立目录内)。
    if model_dir.is_file():
        model_dir = model_dir.parent
    freed = getattr(entry, "size_bytes", 0) if entry else 0
    if not freed:
        freed = _dir_size_bytes(model_dir)
    try:
        shutil.rmtree(model_dir)
    except OSError as e:
        logger.warning("[uninstall] rmtree %s 失败: %r", model_dir, e)
        return {"ok": False, "reason": "error", "detail": str(e)}

    # ⑤ 重扫
    try:
        from chayuan.server.model_registry.local_index import scan_once
        scan_once(persist=True)
    except Exception as e:  # noqa: BLE001 — 重扫失败不回滚删盘(下次启动会重扫)
        logger.warning("[uninstall] scan_once 失败(不阻塞): %r", e)

    # ⑥ 刷新 enabled 清单
    result: Dict[str, Any] = {"ok": True, "freed_bytes": int(freed)}
    if runtime_cap:
        try:
            _refresh_platform_after_remove(runtime_cap, mgr, was_in_use=bool(in_use_cap))
        except Exception as e:  # noqa: BLE001 — 平台刷新失败不回滚,提示需重启
            logger.warning("[uninstall] 刷新 local-%s 平台失败: %r", runtime_cap, e)
            result["note"] = "平台清单刷新失败,可能需重启 sidecar 生效"
    return result


def _refresh_platform_after_remove(runtime_cap: str, mgr, *, was_in_use: bool) -> None:
    """删除模型并重扫后,刷新 ``local-<cap>`` 平台 enabled 清单。

    * 删的是在跑模型:已在 ③ stop sidecar(stop 内部 deregister enabled=False),
      无需再动 —— 平台已落 disabled。
    * 删的不是在跑模型且 sidecar 仍 ready:重注册,model_list 从重扫后的
      local_index 重建,自动排除已删模型。
    """
    if was_in_use:
        return  # stop 已 deregister
    if mgr is None:
        try:
            from chayuan.server.model_registry.local_runtime_registry import get_registry
            mgr = get_registry().get(runtime_cap)
        except Exception:  # noqa: BLE001
            return
    st = getattr(mgr, "status", None)
    if not st or getattr(st, "state", None) != "ready":
        # sidecar 没在跑 → 平台清单下次 start 时按新 local_index 重建,无需现在动
        return
    endpoint = getattr(st, "endpoint", None)  # 形如 http://127.0.0.1:PORT/v1
    if not endpoint:
        return
    # 从 endpoint 解出 host/port
    host, port = _split_endpoint(endpoint)
    if host is None or port is None:
        return
    from chayuan.server.model_registry.local_runtime import _register_local_platform
    _register_local_platform(
        capability=runtime_cap, host=host, port=port,
        model_id=getattr(st, "model_id", None),
    )


def _split_endpoint(endpoint: str):
    """``http://127.0.0.1:8080/v1`` → (host, port)。解析失败返回 (None, None)。"""
    try:
        from urllib.parse import urlparse
        u = urlparse(endpoint)
        return u.hostname, u.port
    except (ValueError, TypeError):
        return None, None


__all__ = [
    "resolve_model_dir",
    "is_bundled_readonly",
    "uninstall",
]

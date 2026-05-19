"""按 model_id 下载单个模型 — 给"本地模型服务"UI 行内的「下载模型」入口用。

跟 ``install_job.py`` 的区别
=========================

``install_job.py`` 是"按 release 包(lite/standard/pro)下载预定清单",路径
``POST /admin/models/install_release``。本模块是"按用户输入的 model_id 自由下载",
路径 ``POST /admin/models/install_model``。

设计要点
========

* **下载源默认 modelscope**:对应 UI 上"打开 modelscope.cn 搜模型"。允许覆盖到
  huggingface(走已有 hf-mirror 镜像逻辑)。
* **落点对齐 bundled 约定**:``<CHAYUAN_ROOT>/models/bundled/<capability>/<safe-id>/``,
  跟 ``install_job._user_bundled_root()`` 同根。下完 ``scan_once`` 就能识别。
* **capability 白名单**:必须是 ``catalog.py`` 已知的 cap(chat / text-embedding /
  rerank / speech-to-text / image-embedding / image-to-text / ...);避免用户随便
  传一个字符串落到 ``bundled/garbage/`` 把 scanner 搞乱。
* **可选 specific_file**:GGUF 多 quant 仓库(如 ``Qwen3-4B-GGUF`` 里有 Q4/Q5/Q8)
  让用户挑一个 .gguf 单文件下载,而不是整仓 ~20GB。HF transformers 仓默认整仓下。
* **In-process 线程**:跟 install_job 一致 —— PyInstaller frozen sidecar 没法
  subprocess 模块,只能直接调 SDK。
* **进度粒度**:per-file(modelscope/hf snapshot 都不暴露 per-byte callback);
  GGUF 单文件就是一步,整仓 snapshot 走 SDK 内部进度,展现为 progress_pct=50%。
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Deque, Dict, Optional

logger = logging.getLogger("chayuan.model_registry.install_model")


class ModelJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


# 允许的 capability(catalog.py MODEL_TYPES 子集 + 同义词)
# 跟 identifier.py / scan_once 输出的 cap 名一致,这样 scan 完直接归类对。
_ALLOWED_CAPS = frozenset({
    "chat",
    "text-embedding",
    "image-embedding",
    "rerank",
    "speech-to-text",
    "image-to-text",
    "text-to-image",
    "text-to-video",
    "text-to-audio",
    "other",
})

# UI 上 cap 行内按钮按 cap 名传过来时,前端可能用 "embedding" 简写,这里映射成内部
# 标准 cap(catalog.py 用的 "text-embedding")。
_CAP_ALIAS = {
    "embedding": "text-embedding",
    "asr": "speech-to-text",
    "ocr": "image-to-text",
    "tts": "text-to-audio",
    "image": "text-to-image",
}

_ALLOWED_SOURCES = ("modelscope", "huggingface")

# 落到 bundled 时按 cap 名建子目录;这里映射成跟现有 vendor/bundled_models/ 目录名
# 一致的简写,scan_once 看到 path keyword 也能识别。
_CAP_TO_BUNDLED_DIR = {
    "chat": "chat",
    "text-embedding": "embedding",
    "image-embedding": "image",
    "rerank": "rerank",
    "speech-to-text": "asr",
    "image-to-text": "ocr",
    "text-to-image": "image",
    "text-to-video": "video",
    "text-to-audio": "tts",
    "other": "custom",
}

_MIRROR_ENDPOINTS = {
    "hf-mirror":   "https://hf-mirror.com",
    "huggingface": "https://huggingface.co",
}


def _normalize_cap(cap: str) -> str:
    cap = (cap or "").strip()
    cap = _CAP_ALIAS.get(cap, cap)
    if cap not in _ALLOWED_CAPS:
        raise ValueError(
            f"unsupported capability {cap!r}; allowed: {sorted(_ALLOWED_CAPS)} "
            f"(也接受别名 {sorted(_CAP_ALIAS)})"
        )
    return cap


# model_id 安全校验:防止 ".." / 绝对路径 / shell 注入字符
# modelscope 风格 "owner/name" 或 "owner/name.git";HF 同样 "owner/name"
_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9._-]+)?$")


def _validate_model_id(model_id: str) -> str:
    model_id = (model_id or "").strip()
    if not model_id:
        raise ValueError("model_id 不能为空")
    if not _MODEL_ID_RE.match(model_id):
        raise ValueError(
            f"model_id {model_id!r} 不合法;应形如 'owner/name' "
            "(只允许字母数字 . _ -,一个 / 分隔)"
        )
    return model_id


_FILENAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _validate_filename(name: Optional[str]) -> Optional[str]:
    if name is None:
        return None
    name = name.strip()
    if not name:
        return None
    if not _FILENAME_RE.match(name):
        raise ValueError(
            f"specific_file {name!r} 不合法;只允许字母数字 . _ -(不允许路径分隔符)"
        )
    return name


def _repo_safe_name(repo: str) -> str:
    return repo.replace("/", "--")


def _user_bundled_root() -> Path:
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT) / "models" / "bundled"


# 把 catalog cap 名(text-embedding / speech-to-text 等)映射到
# LocalRuntimeRegistry.CAPABILITIES 用的 5 个短名(chat/embedding/rerank/asr/image-embedding)。
# 不在表里的 cap 不走 auto-start(image-to-text 走独立的 rapidocr sidecar,跟 llama runtime 不一样)。
_CAP_TO_RUNTIME = {
    "chat": "chat",
    "text-embedding": "embedding",
    "rerank": "rerank",
    "speech-to-text": "asr",
    "image-embedding": "image-embedding",
}


def trigger_auto_start_for_cap(catalog_cap: str) -> bool:
    """扫到新模型 / 用户手动放好模型后,自动起 cap 的本地 runtime。

    跨场景共用:
      * install_model_job 下载完成
      * POST /api/v1/runtime/models/scan-and-mount 用户手动扫描

    Args:
        catalog_cap: catalog.py 标准 cap 名(如 ``text-embedding``)。
            内部映射到 LocalRuntimeRegistry 的短名。

    Returns:
        True = 触发了 start(可能还在 starting,需要前端轮询 status);
        False = cap 不支持 auto-start,或当前已 ready/starting。
    """
    runtime_cap = _CAP_TO_RUNTIME.get(catalog_cap)
    if runtime_cap is None:
        logger.info("[install_model] cap=%s 不在 auto-start 范围", catalog_cap)
        return False

    try:
        from chayuan.server.model_registry.local_runtime_registry import get_registry
    except ImportError as e:
        logger.warning("[install_model] 无法 import local_runtime_registry: %r", e)
        return False

    try:
        mgr = get_registry().get(runtime_cap)
    except ValueError as e:
        logger.warning("[install_model] runtime cap %r 不存在: %r", runtime_cap, e)
        return False

    # 已经 ready/starting,就不重复触发(SidecarRuntimeManager 内部也会去重,这里早返回省事)
    try:
        cur_state = mgr.status.state
        if cur_state in ("ready", "starting"):
            logger.info("[install_model] cap=%s 已 %s,跳过 auto-start", runtime_cap, cur_state)
            return False
    except Exception:  # noqa: BLE001
        # status 拿不到也别阻塞,继续 start 一下;manager 内部会处理
        pass

    # start() 是 async,但我们在工作线程里,用 asyncio.run 起新 loop
    # (不能借用 main loop — manager 可能持有锁,跨线程 await 不安全)
    import asyncio
    try:
        asyncio.run(mgr.start(model_id=None))
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("[install_model] auto-start cap=%s 失败: %r", runtime_cap, e)
        return False


@dataclass
class InstallModelJob:
    id: str
    source: str            # modelscope / huggingface
    model_id: str          # 用户输入的 owner/name
    capability: str        # 已规范化的 cap(catalog 标准名)
    requested_file: Optional[str]
    status: ModelJobStatus
    started_at: float
    ended_at: Optional[float] = None
    exit_code: Optional[int] = None
    step: str = ""
    progress_pct: float = 0.0
    progress_message: str = ""
    log_tail: Deque[str] = field(default_factory=lambda: deque(maxlen=200))
    target_dir: Optional[str] = None   # 完成后的实际落地路径
    _cancel_requested: bool = field(default=False, repr=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "model_id": self.model_id,
            "capability": self.capability,
            "requested_file": self.requested_file,
            "status": self.status.value,
            "step": self.step,
            "started_at": float(self.started_at),
            "ended_at": float(self.ended_at) if self.ended_at is not None else None,
            "exit_code": int(self.exit_code) if self.exit_code is not None else None,
            "progress_pct": round(float(self.progress_pct), 2),
            "progress_message": self.progress_message,
            "target_dir": self.target_dir,
            "log_tail": list(self.log_tail),
        }


class InstallModelJobManager:
    """跟 InstallJobManager 解耦的单模型下载管理器。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._jobs: Dict[str, InstallModelJob] = {}

    def start(
        self,
        *,
        source: str,
        model_id: str,
        capability: str,
        specific_file: Optional[str] = None,
    ) -> InstallModelJob:
        if source not in _ALLOWED_SOURCES:
            raise ValueError(
                f"unsupported source {source!r}; allowed: {list(_ALLOWED_SOURCES)}"
            )
        norm_cap = _normalize_cap(capability)
        norm_id = _validate_model_id(model_id)
        norm_file = _validate_filename(specific_file)

        with self._lock:
            # 同一 model_id + cap 已经在跑就拒绝(避免重复硬盘竞争)
            for j in self._jobs.values():
                if (j.model_id == norm_id and j.capability == norm_cap
                        and j.status in (ModelJobStatus.QUEUED, ModelJobStatus.RUNNING)):
                    raise RuntimeError(
                        f"{norm_id} ({norm_cap}) 已有运行中任务 {j.id} "
                        f"(status={j.status.value})"
                    )
            job = InstallModelJob(
                id=str(uuid.uuid4()),
                source=source,
                model_id=norm_id,
                capability=norm_cap,
                requested_file=norm_file,
                status=ModelJobStatus.QUEUED,
                started_at=time.time(),
            )
            self._jobs[job.id] = job

        t = threading.Thread(
            target=self._run, args=(job,),
            daemon=True, name=f"install-model-{job.id[:8]}",
        )
        t.start()
        return job

    def get(self, job_id: str) -> Optional[InstallModelJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> InstallModelJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(f"unknown job_id {job_id!r}")
            if job.status in (ModelJobStatus.SUCCEEDED, ModelJobStatus.FAILED,
                              ModelJobStatus.CANCELLED):
                return job
            job._cancel_requested = True
        return job

    def _run(self, job: InstallModelJob) -> None:
        with self._lock:
            job.status = ModelJobStatus.RUNNING
            job.step = "preparing"
            job.log_tail.append(
                f"[install_model] start: source={job.source} model={job.model_id} "
                f"cap={job.capability} file={job.requested_file or '(整仓)'}"
            )

        # 1. 准备目录
        bundled_root = _user_bundled_root()
        cap_subdir = _CAP_TO_BUNDLED_DIR.get(job.capability, "custom")
        target_dir = bundled_root / cap_subdir / _repo_safe_name(job.model_id)
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            self._fail_with_traceback(
                job, f"创建目标目录失败 {target_dir}", e, target_dir,
            )
            return
        with self._lock:
            job.target_dir = str(target_dir)
            job.progress_message = f"下载到 {target_dir}"
            job.log_tail.append(f"[install_model] target_dir={target_dir}")
            if job._cancel_requested:
                self._set_cancelled(job)
                return

        # 2. 调对应 SDK
        with self._lock:
            job.step = "downloading"
        try:
            if job.source == "modelscope":
                self._download_modelscope(job, target_dir)
            else:
                self._download_huggingface(job, target_dir)
        except _Cancelled:
            self._set_cancelled(job)
            return
        except Exception as e:  # noqa: BLE001
            logger.exception("install_model %s 下载失败", job.model_id)
            self._fail_with_traceback(job, "下载失败", e, target_dir)
            return

        # 3. 扫盘 + 完成
        with self._lock:
            job.step = "finalizing"
            job.progress_pct = 95.0
            job.progress_message = "扫描磁盘以识别新模型"

        try:
            from chayuan.server.model_registry.local_index import scan_once
            scan_once()
        except Exception as e:  # noqa: BLE001
            logger.warning("[install_model] post-install scan_once 失败: %r", e)
            with self._lock:
                job.log_tail.append(f"[install_model] scan_once 失败(不阻塞): {e!r}")

        # 自动挂载:扫到模型后,尝试启动对应 cap 的本地 runtime。
        # 失败不影响 job 成功状态 — 用户在 UI 上还能手动点启动。
        auto_started = trigger_auto_start_for_cap(job.capability)
        with self._lock:
            if auto_started:
                job.log_tail.append(
                    f"[install_model] auto-start triggered for cap={job.capability}"
                )
                job.progress_message = "下载完成,正在自动启动模型服务…"
            else:
                job.log_tail.append(
                    f"[install_model] auto-start 未触发 "
                    f"(cap={job.capability} 不在 LocalRuntimeRegistry 支持范围,"
                    "或已 running;用户可在设置页手动操作)"
                )

        with self._lock:
            job.step = "done"
            job.status = ModelJobStatus.SUCCEEDED
            job.exit_code = 0
            job.progress_pct = 100.0
            job.progress_message = (
                "下载完成,模型服务正在启动" if auto_started else "下载完成,模型已可用"
            )
            job.ended_at = time.time()
            job.log_tail.append("[install_model] success")

    def _download_modelscope(self, job: InstallModelJob, target_dir: Path) -> None:
        # modelscope SDK:延迟 import,避免依赖在不需要时被拉
        try:
            from modelscope.hub.snapshot_download import snapshot_download as ms_snapshot
            from modelscope.hub.file_download import model_file_download as ms_file
        except ImportError as e:
            raise RuntimeError(
                "modelscope SDK 未安装;请检查打包配置 "
                "(`pip install modelscope`)"
            ) from e

        self._check_cancel(job)
        with self._lock:
            job.progress_pct = 10.0

        if job.requested_file:
            with self._lock:
                job.log_tail.append(
                    f"[install_model] modelscope single-file: "
                    f"{job.model_id} :: {job.requested_file}"
                )
            local_path = ms_file(
                model_id=job.model_id,
                file_path=job.requested_file,
                cache_dir=str(target_dir),
            )
            with self._lock:
                job.log_tail.append(f"[install_model] downloaded → {local_path}")
        else:
            with self._lock:
                job.log_tail.append(f"[install_model] modelscope snapshot: {job.model_id}")
            ms_snapshot(model_id=job.model_id, cache_dir=str(target_dir))

        with self._lock:
            job.progress_pct = 90.0

    def _download_huggingface(self, job: InstallModelJob, target_dir: Path) -> None:
        # 默认走 hf-mirror(国内),用户可在 install_job 那边设过 HF_ENDPOINT
        os.environ.setdefault("HF_ENDPOINT", _MIRROR_ENDPOINTS["hf-mirror"])
        try:
            from huggingface_hub import hf_hub_download, snapshot_download
        except ImportError as e:
            raise RuntimeError("huggingface_hub 未安装") from e

        self._check_cancel(job)
        with self._lock:
            job.progress_pct = 10.0
            job.log_tail.append(
                f"[install_model] HF_ENDPOINT={os.environ['HF_ENDPOINT']}"
            )

        if job.requested_file:
            with self._lock:
                job.log_tail.append(
                    f"[install_model] hf single-file: "
                    f"{job.model_id} :: {job.requested_file}"
                )
            hf_hub_download(
                repo_id=job.model_id,
                filename=job.requested_file,
                local_dir=str(target_dir),
            )
        else:
            with self._lock:
                job.log_tail.append(f"[install_model] hf snapshot: {job.model_id}")
            snapshot_download(repo_id=job.model_id, local_dir=str(target_dir))

        with self._lock:
            job.progress_pct = 90.0

    def _check_cancel(self, job: InstallModelJob) -> None:
        with self._lock:
            if job._cancel_requested:
                raise _Cancelled()

    def _set_cancelled(self, job: InstallModelJob) -> None:
        with self._lock:
            job.status = ModelJobStatus.CANCELLED
            job.exit_code = -1
            job.ended_at = time.time()
            job.log_tail.append("[install_model] cancelled")

    def _fail(self, job: InstallModelJob, msg: str) -> None:
        with self._lock:
            job.log_tail.append(f"[install_model] {msg}")
            job.status = ModelJobStatus.FAILED
            job.exit_code = 1
            job.ended_at = time.time()

    def _fail_with_traceback(
        self,
        job: InstallModelJob,
        prefix: str,
        exc: BaseException,
        target_dir: Path,
    ) -> None:
        """失败时把 traceback / OSError 细节 / 路径诊断都写进 log_tail。

        老逻辑只记一行 ``type(e).__name__: e``,排查 Windows 上 Errno 22 / 长路径
        / 文件名非法字符这类问题完全没线索。这里把:
          - 完整 traceback(最多 60 行 — 长 stack 没用,核心 frame 就够)
          - OSError.errno / .filename / .winerror(Windows pywin32 的 attr)
          - target_dir 字符串长度 + 是否含非 ASCII / `:` / 长路径风险
          - 显著的 SDK 内部 cache 路径(HF / modelscope 各自的 cache_dir)
        全写进去,后续可以一次性贴出来对症修。
        """
        import traceback as _tb

        with self._lock:
            job.log_tail.append(f"[install_model] {prefix}: {type(exc).__name__}: {exc}")

            # OSError 细节(Errno 22 / 32 / 145 / -2 等都靠这个分流)
            if isinstance(exc, OSError):
                detail_parts = []
                if exc.errno is not None:
                    detail_parts.append(f"errno={exc.errno}")
                # filename / filename2 可能指向真正出错的路径(比 message 准)
                if getattr(exc, "filename", None):
                    detail_parts.append(f"filename={exc.filename!r}")
                if getattr(exc, "filename2", None):
                    detail_parts.append(f"filename2={exc.filename2!r}")
                # Windows pywin32 风格的 winerror
                if getattr(exc, "winerror", None) is not None:
                    detail_parts.append(f"winerror={exc.winerror}")
                if detail_parts:
                    job.log_tail.append(
                        f"[install_model]   OSError detail: {' '.join(detail_parts)}"
                    )
                # Errno 22 / WinError 87 = Invalid argument。Windows 上最常见原因:
                # 文件名含 `:` / `*` / `?` / `|` 等保留字符,或路径 > 260 且没开
                # LongPathsEnabled。这两条都给一行 hint,用户对照自己看。
                if exc.errno == 22 or getattr(exc, "winerror", None) == 87:
                    job.log_tail.append(
                        "[install_model]   Errno 22 / WinError 87 常见根因:\n"
                        "      - Windows 文件名禁用字符 (`:` `*` `?` `|` `\"` `<` `>`) — "
                        "HF/modelscope cache 内部可能写 .lock-blob:<sha> 这类带冒号的文件,"
                        "Windows 不接受;\n"
                        "      - 路径长度 > 260 且没开 LongPathsEnabled;\n"
                        "      - 临时文件被杀软扫描时锁住。"
                    )

            # 路径诊断(只针对 Windows 高风险情况,Linux/macOS 也无害)
            target_str = str(target_dir)
            extra_colons = target_str.count(":") > 1  # Windows 盘符占用 1 个,>1 才异常
            has_non_ascii = any(ord(c) > 127 for c in target_str)
            job.log_tail.append(
                f"[install_model]   target_dir 长度={len(target_str)} 字符;"
                f"含非 ASCII={has_non_ascii};"
                f"含冒号(非盘符)={extra_colons};"
                f"path={target_str!r}"
            )
            if len(target_str) > 200:
                job.log_tail.append(
                    "[install_model]   ⚠ target_dir 已 > 200 字符,下载的子文件再嵌一层"
                    "极易超 Windows MAX_PATH 260。建议把 CHAYUAN_ROOT 换成短路径"
                    "(如 C:\\chayuan)或开 LongPathsEnabled。"
                )

            # 完整 traceback,截到 60 行避免刷屏(实际 frame 通常 < 20)
            tb_lines = _tb.format_exception(type(exc), exc, exc.__traceback__)
            tb_flat: list[str] = []
            for chunk in tb_lines:
                tb_flat.extend(chunk.rstrip().split("\n"))
            if len(tb_flat) > 60:
                tb_flat = tb_flat[:30] + [f"  ... (中间 {len(tb_flat) - 60} 行省略) ..."] + tb_flat[-30:]
            job.log_tail.append("[install_model]   traceback:")
            for line in tb_flat:
                job.log_tail.append(f"[install_model]     {line}")

            job.status = ModelJobStatus.FAILED
            job.exit_code = 1
            job.ended_at = time.time()


class _Cancelled(Exception):
    """内部用,信号取消请求(避免在 lock 内抛复杂异常)。"""


_SINGLETON: Optional[InstallModelJobManager] = None
_SINGLETON_LOCK = threading.Lock()


def get_install_model_manager() -> InstallModelJobManager:
    global _SINGLETON
    if _SINGLETON is None:
        with _SINGLETON_LOCK:
            if _SINGLETON is None:
                _SINGLETON = InstallModelJobManager()
    return _SINGLETON


def _reset_manager_for_test() -> None:
    global _SINGLETON
    with _SINGLETON_LOCK:
        _SINGLETON = None


__all__ = [
    "InstallModelJob",
    "InstallModelJobManager",
    "ModelJobStatus",
    "get_install_model_manager",
    "trigger_auto_start_for_cap",
]

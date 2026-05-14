"""模型下载编排 — 给 GUI 一个能从前端触发 ``chayuan_packaging`` 的入口。

为什么需要
==========

``GET /admin/models/bootstrap`` 已经能告诉前端"缺哪些 capability + 推荐哪个
release",但用户拿到这个提示后:

* 现状:必须打开终端,跑 ``python -m chayuan_packaging fetch+stage --release X``;
* 期望:GUI 上点"下载推荐包",server 后台拉下来即可。

本模块就是中间这层 —— 接前端 POST 请求,在 server 进程里 spawn subprocess
跑 ``chayuan_packaging``,把进度日志缓存进 tail,前端轮询拿状态。

设计要点
========

* **subprocess 而非 in-process import**:packaging 涉及大量 IO 与网络,起
  独立 Python 进程避免阻塞 server 事件循环,也避免 huggingface_hub 等
  库与 server 进程共享状态。
* **每个 release 同时只能一个 running 任务**:重复请求拒绝;避免硬盘竞争。
* **内存状态,无持久化**:server 重启后 in-flight 任务被遗忘,这是有意的 —
  ``chayuan_packaging`` 自己的 ``packaging/.cache`` 已经记录半下载状态,
  下次重新请求会续跑。
* **镜像白名单**:防止用户传任意 URL 触发 SSRF;只支持 ``hf-mirror`` /
  ``huggingface`` 两条已知路径。
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

logger = logging.getLogger("chayuan.model_registry.install_job")


class JobStatus(str, Enum):
    """任务状态机 —— queued → running → (succeeded | failed | cancelled)。"""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


_ALLOWED_RELEASES = {"lite", "standard", "pro"}

# 镜像 → ``chayuan_packaging fetch --hf-mirror`` 参数。modelscope 需要另一套
# fetcher,本批不支持,留作下次扩展。
_MIRROR_ENDPOINTS = {
    "hf-mirror":   "https://hf-mirror.com",
    "huggingface": "https://huggingface.co",
}


@dataclass
class InstallJob:
    """单次下载任务的运行时记录。

    Attributes:
        id: UUID4 字符串。
        release: ``lite`` / ``standard`` / ``pro``。
        mirror: 镜像别名(``hf-mirror`` 等),None=用 packaging 默认。
        status: 状态机当前值。
        started_at: epoch 秒,任务创建时刻。
        ended_at: epoch 秒,首次进入终态时刻。
        exit_code: 子进程退出码(仅终态时有值)。
        log_tail: stdout/stderr 行缓冲(最多 200 行)。
        step: 当前在哪一步(``fetch`` / ``stage`` / ``done``),便于前端
            显示"已下载完成,正在解压…"。
    """

    id: str
    release: str
    mirror: Optional[str]
    status: JobStatus
    started_at: float
    ended_at: Optional[float] = None
    exit_code: Optional[int] = None
    step: str = ""
    log_tail: Deque[str] = field(default_factory=lambda: deque(maxlen=200))
    # 内部字段:取消标志 + 当前 subprocess.Popen 引用(供 cancel() 用)。
    # 不进 to_dict;由 manager 锁保护读写。
    _cancel_requested: bool = field(default=False, repr=False)
    _proc: Optional[Any] = field(default=None, repr=False)  # type: ignore[name-defined]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "release": self.release,
            "mirror": self.mirror,
            "status": self.status.value,
            "step": self.step,
            "started_at": float(self.started_at),
            "ended_at": float(self.ended_at) if self.ended_at is not None else None,
            "exit_code": (int(self.exit_code) if self.exit_code is not None else None),
            "log_tail": list(self.log_tail),
        }


class InstallJobManager:
    """线程安全的任务注册中心 + subprocess 调度。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._jobs: Dict[str, InstallJob] = {}

    # ── public API ────────────────────────────────────────────────

    def start(
        self,
        release: str,
        mirror: Optional[str] = None,
        *,
        repo_root: Optional[Path] = None,
    ) -> InstallJob:
        """启动新任务。返回 :class:`InstallJob` 引用,调用方拿 ``id`` 后续轮询。

        Raises:
            ValueError: release / mirror 不在白名单,或参数非法。
            RuntimeError: 同 release 已有 queued / running 任务。
        """
        if release not in _ALLOWED_RELEASES:
            raise ValueError(
                f"unsupported release {release!r}; allowed: {sorted(_ALLOWED_RELEASES)}"
            )
        if mirror is not None and mirror not in _MIRROR_ENDPOINTS:
            raise ValueError(
                f"unknown mirror {mirror!r}; allowed: {sorted(_MIRROR_ENDPOINTS)}"
            )

        with self._lock:
            for j in self._jobs.values():
                if j.release == release and j.status in (
                    JobStatus.QUEUED, JobStatus.RUNNING,
                ):
                    raise RuntimeError(
                        f"release {release!r} 已有运行中任务 {j.id} (status={j.status.value})"
                    )
            job = InstallJob(
                id=str(uuid.uuid4()),
                release=release,
                mirror=mirror,
                status=JobStatus.QUEUED,
                started_at=time.time(),
            )
            self._jobs[job.id] = job

        t = threading.Thread(
            target=self._run, args=(job, repo_root),
            daemon=True, name=f"install-{release}-{job.id[:8]}",
        )
        t.start()
        return job

    def get(self, job_id: str) -> Optional[InstallJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> List[InstallJob]:
        """按 started_at 倒序返回所有已知任务。"""
        with self._lock:
            return sorted(self._jobs.values(),
                          key=lambda j: j.started_at, reverse=True)

    def cancel(self, job_id: str) -> InstallJob:
        """请求中止 ``job_id``,返回当前 job 视图。

        语义:
        * 已是终态(succeeded/failed/cancelled) → no-op,返回原状态
        * queued/running → 置 cancel 标志,若已 spawn subprocess 则 SIGTERM
          (后台线程在下次循环点检测后过渡到 CANCELLED 终态)

        Raises:
            KeyError: job_id 未知。
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(f"unknown job_id {job_id!r}")
            if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED):
                return job
            job._cancel_requested = True
            proc = job._proc
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except Exception as e:  # noqa: BLE001
                logger.warning("[install_job] cancel(%s) terminate 失败: %r", job_id, e)
        return job

    # ── internals ─────────────────────────────────────────────────

    def _run(self, job: InstallJob, repo_root: Optional[Path]) -> None:
        """后台线程:依次跑 fetch + stage,把日志缓存进 tail。"""
        with self._lock:
            job.status = JobStatus.RUNNING
            job.step = "fetch"
        env = dict(os.environ)

        for step in ("fetch", "stage"):
            # 进入下一步前先看 cancel 标志,避免 fetch 失败回到这里又跑 stage
            with self._lock:
                if job._cancel_requested:
                    job.status = JobStatus.CANCELLED
                    job.ended_at = time.time()
                    job.log_tail.append("[install_job] 收到取消请求,终止")
                    return

            cmd = [sys.executable, "-m", "chayuan_packaging", step,
                   "--release", job.release]
            if job.mirror:
                cmd.extend(["--hf-mirror", _MIRROR_ENDPOINTS[job.mirror]])

            with self._lock:
                job.step = step
                job.log_tail.append(f"[install_job] $ {' '.join(cmd)}")

            try:
                rc = self._run_subprocess(job, cmd, repo_root, env)
            except Exception as e:  # noqa: BLE001
                logger.exception("install_job step %s 异常", step)
                with self._lock:
                    job.log_tail.append(
                        f"[install_job] 异常: {type(e).__name__}: {e}"
                    )
                    job.status = JobStatus.FAILED
                    job.ended_at = time.time()
                return

            # subprocess 可能因取消而被 SIGTERM,returncode 通常非 0。
            with self._lock:
                if job._cancel_requested:
                    job.exit_code = rc
                    job.status = JobStatus.CANCELLED
                    job.ended_at = time.time()
                    job.log_tail.append(
                        f"[install_job] 已取消 (step={step}, exit={rc})"
                    )
                    return

            if rc != 0:
                with self._lock:
                    job.exit_code = rc
                    job.status = JobStatus.FAILED
                    job.ended_at = time.time()
                    job.log_tail.append(
                        f"[install_job] step {step} 失败 (exit={rc}),终止后续步骤"
                    )
                return

        # 成功后:扫盘 + 自动指派 default,让 chat / retrieval 装完即用,
        # 不强求用户先去设置页走一遍。任何环节失败仅记日志,不影响 job 成功。
        try:
            from chayuan.server.model_registry.local_index import scan_once
            scan_once()
        except Exception as e:  # noqa: BLE001
            logger.warning("[install_job] post-install scan_once 失败: %r", e)
        try:
            from chayuan.server.model_registry.auto_assign import (
                promote_defaults_from_local,
            )
            promoted = promote_defaults_from_local()
        except Exception as e:  # noqa: BLE001
            logger.warning("[install_job] post-install auto_assign 失败: %r", e)
            promoted = {}

        with self._lock:
            job.step = "done"
            job.exit_code = 0
            job.status = JobStatus.SUCCEEDED
            job.ended_at = time.time()
            if promoted:
                job.log_tail.append(
                    f"[install_job] 自动指派默认: " +
                    ", ".join(f"{k}={v}" for k, v in promoted.items())
                )

    def _run_subprocess(
        self,
        job: InstallJob,
        cmd: List[str],
        repo_root: Optional[Path],
        env: Dict[str, str],
    ) -> int:
        """跑一条命令,逐行抓 stdout/stderr 写到 tail。返回 returncode。"""
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=str(repo_root) if repo_root else None,
            env=env,
        )
        # 把 proc 引用挂到 job 上,cancel() 才能 SIGTERM
        with self._lock:
            job._proc = proc
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                with self._lock:
                    job.log_tail.append(line.rstrip())
        finally:
            proc.wait()
            with self._lock:
                job._proc = None
        return int(proc.returncode)


# ─────────────────────── 进程内单例 ───────────────────────


_SINGLETON: Optional[InstallJobManager] = None
_SINGLETON_LOCK = threading.Lock()


def get_install_manager() -> InstallJobManager:
    """全局唯一 :class:`InstallJobManager`。"""
    global _SINGLETON
    if _SINGLETON is None:
        with _SINGLETON_LOCK:
            if _SINGLETON is None:
                _SINGLETON = InstallJobManager()
    return _SINGLETON


__all__ = [
    "InstallJob",
    "InstallJobManager",
    "JobStatus",
    "get_install_manager",
]

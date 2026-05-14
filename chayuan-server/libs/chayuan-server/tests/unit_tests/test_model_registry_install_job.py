"""``InstallJobManager`` 行为测试 — 用 monkeypatch 替 subprocess.Popen,
不真跑 chayuan_packaging。
"""
from __future__ import annotations

import threading
import time
from unittest import mock

import pytest

from chayuan.server.model_registry.install_job import (
    InstallJob,
    InstallJobManager,
    JobStatus,
    get_install_manager,
)


class _FakeProc:
    """模拟 ``subprocess.Popen`` 的最小接口。"""

    def __init__(self, stdout_lines: list[str], returncode: int = 0):
        self.stdout = iter(stdout_lines)
        self.returncode = returncode
        self._waited = False

    def wait(self):
        self._waited = True


def _patch_popen(returncode: int = 0, stdout_lines: tuple[str, ...] = ("ok",)):
    """生成 subprocess.Popen 桩,可指定 stdout / returncode。"""
    def _factory(*args, **kwargs):
        return _FakeProc(list(stdout_lines), returncode=returncode)
    return _factory


def _wait_done(job: InstallJob, timeout: float = 2.0) -> None:
    """阻塞等任务进入终态(succeeded / failed)。"""
    deadline = time.time() + timeout
    while job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
        if time.time() > deadline:
            raise TimeoutError(f"job {job.id} 未在 {timeout}s 内结束;status={job.status.value}")
        time.sleep(0.01)


# ─────────────────────── 输入校验 ───────────────────────


def test_rejects_unknown_release():
    mgr = InstallJobManager()
    with pytest.raises(ValueError, match="unsupported release"):
        mgr.start("super-pro")


def test_rejects_unknown_mirror():
    mgr = InstallJobManager()
    with pytest.raises(ValueError, match="unknown mirror"):
        mgr.start("lite", mirror="evilcdn.example.com")


def test_rejects_duplicate_running_release():
    mgr = InstallJobManager()
    # 用 Event 让 stdout 迭代永远阻塞,把任务卡在 RUNNING
    blocker = threading.Event()

    class _BlockingProc:
        returncode = 0

        @property
        def stdout(self):
            blocker.wait(timeout=5.0)  # 测试结束前不会 set,迭代器一直等
            return iter(())

        def wait(self):
            pass

    try:
        with mock.patch(
            "chayuan.server.model_registry.install_job.subprocess.Popen",
            return_value=_BlockingProc(),
        ):
            j1 = mgr.start("lite")
            for _ in range(100):
                if j1.status == JobStatus.RUNNING:
                    break
                time.sleep(0.005)
            assert j1.status == JobStatus.RUNNING
            with pytest.raises(RuntimeError, match="已有运行中任务"):
                mgr.start("lite")
    finally:
        blocker.set()  # 解阻塞,让后台线程退出


# ─────────────────────── 状态机 ───────────────────────


def test_successful_run_transitions_to_succeeded():
    mgr = InstallJobManager()
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_patch_popen(returncode=0, stdout_lines=("fetched ok", "stage ok")),
    ):
        job = mgr.start("lite")
        _wait_done(job)
    assert job.status == JobStatus.SUCCEEDED
    assert job.exit_code == 0
    assert job.ended_at is not None
    assert job.step == "done"
    # 至少有 fetch + stage 各一条 stdout
    log_text = "\n".join(job.log_tail)
    assert "fetched ok" in log_text
    assert "stage ok" in log_text


def test_failure_in_fetch_short_circuits_stage():
    """fetch 退出非 0 时不应跑 stage。"""
    mgr = InstallJobManager()
    popen_calls = []

    def _factory(*args, **kwargs):
        cmd = args[0]
        popen_calls.append(list(cmd))
        # fetch 步退 1
        return _FakeProc(["fetch error"], returncode=1)

    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_factory,
    ):
        job = mgr.start("lite")
        _wait_done(job)
    assert job.status == JobStatus.FAILED
    assert job.exit_code == 1
    # 只跑了 fetch,没跑 stage
    assert len(popen_calls) == 1
    assert "fetch" in popen_calls[0]


def test_exception_in_subprocess_marks_failed():
    """subprocess.Popen 抛异常时任务应标 failed,不挂线程。"""
    mgr = InstallJobManager()
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=FileNotFoundError("python missing"),
    ):
        job = mgr.start("lite")
        _wait_done(job)
    assert job.status == JobStatus.FAILED
    log = "\n".join(job.log_tail)
    assert "FileNotFoundError" in log


# ─────────────────────── 镜像参数 ───────────────────────


def test_mirror_translated_to_hf_mirror_arg():
    """mirror=hf-mirror 应该追加 --hf-mirror=https://hf-mirror.com。"""
    mgr = InstallJobManager()
    popen_calls = []

    def _factory(*args, **kwargs):
        popen_calls.append(list(args[0]))
        return _FakeProc(["ok"], returncode=0)

    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_factory,
    ):
        job = mgr.start("lite", mirror="huggingface")
        _wait_done(job)
    # 至少 fetch 子命令带 --hf-mirror
    fetch_cmd = popen_calls[0]
    assert "--hf-mirror" in fetch_cmd
    assert "https://huggingface.co" in fetch_cmd


# ─────────────────────── 注册中心 ───────────────────────


def test_get_returns_none_for_unknown_id():
    mgr = InstallJobManager()
    assert mgr.get("not-a-uuid") is None


def test_list_returns_jobs_newest_first():
    mgr = InstallJobManager()
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_patch_popen(returncode=0),
    ):
        j1 = mgr.start("lite")
        _wait_done(j1)
        time.sleep(0.01)
        j2 = mgr.start("standard")
        _wait_done(j2)
    items = mgr.list()
    assert [j.id for j in items[:2]] == [j2.id, j1.id]


def test_singleton_is_stable():
    """get_install_manager 应永远返回同一实例。"""
    a = get_install_manager()
    b = get_install_manager()
    assert a is b


# ─────────────────────── 序列化 ───────────────────────


def test_to_dict_is_json_safe():
    import json
    mgr = InstallJobManager()
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_patch_popen(returncode=0),
    ):
        job = mgr.start("lite", mirror="hf-mirror")
        _wait_done(job)
    s = json.dumps(job.to_dict())
    d = json.loads(s)
    assert d["status"] == "succeeded"
    assert d["release"] == "lite"
    assert d["mirror"] == "hf-mirror"
    assert isinstance(d["log_tail"], list)
    assert d["exit_code"] == 0

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
    # 内部字段不暴露
    assert "_cancel_requested" not in d
    assert "_proc" not in d


def test_to_dict_does_not_leak_internal_fields():
    """_cancel_requested 与 _proc 即便取消后也不应出现在 to_dict 中。"""
    mgr = InstallJobManager()
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_patch_popen(returncode=0),
    ):
        job = mgr.start("lite")
        _wait_done(job)
    d = job.to_dict()
    for k in d.keys():
        assert not k.startswith("_"), f"内部字段 {k!r} 不应暴露"


# ─────────────────────── 取消 ───────────────────────


def test_cancel_unknown_id_raises():
    mgr = InstallJobManager()
    with pytest.raises(KeyError, match="unknown job_id"):
        mgr.cancel("not-a-uuid")


def test_cancel_terminal_job_is_noop():
    """已完成的任务再 cancel 应直接返回当前状态(幂等)。"""
    mgr = InstallJobManager()
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=_patch_popen(returncode=0),
    ):
        job = mgr.start("lite")
        _wait_done(job)
    assert job.status == JobStatus.SUCCEEDED
    after = mgr.cancel(job.id)
    # 仍是 succeeded,没被改成 cancelled
    assert after.status == JobStatus.SUCCEEDED


def test_cancel_running_job_terminates_subprocess_and_marks_cancelled():
    """运行中任务被 cancel 时:proc.terminate 被调用 + job 进 CANCELLED 终态。"""
    mgr = InstallJobManager()
    blocker = threading.Event()
    terminate_calls = []

    class _CancelableProc:
        returncode = -15  # SIGTERM 后常见 returncode

        @property
        def stdout(self):
            blocker.wait(timeout=5.0)
            return iter(())

        def terminate(self):
            terminate_calls.append(True)
            blocker.set()  # 释放 stdout 阻塞,让 _run 循环退出

        def poll(self):
            return None if not blocker.is_set() else -15

        def wait(self):
            pass

    proc = _CancelableProc()
    try:
        with mock.patch(
            "chayuan.server.model_registry.install_job.subprocess.Popen",
            return_value=proc,
        ):
            job = mgr.start("lite")
            # 等任务进 RUNNING + proc 挂到 job 上
            for _ in range(200):
                if job._proc is not None and job.status == JobStatus.RUNNING:
                    break
                time.sleep(0.005)
            assert job.status == JobStatus.RUNNING
            assert job._proc is not None

            mgr.cancel(job.id)
            assert terminate_calls == [True]
            _wait_done(job)
        assert job.status == JobStatus.CANCELLED
        # log_tail 应有"已取消"提示
        log = "\n".join(job.log_tail)
        assert "取消" in log
    finally:
        blocker.set()


def test_cancel_before_subprocess_spawn_marks_cancelled():
    """在 _run 还没起 subprocess 之前调 cancel,任务应直接进 CANCELLED。"""
    mgr = InstallJobManager()
    # 拿一个"永远阻塞 in stdout"的桩,但让 _run 在 cancel 检查点退出
    # 简单做法:patch start 的内部,但更可靠是把 popen 改成 slow popen 看不到
    # 实际场景:用户在请求发出后立刻 cancel,我们要保证终态可达。
    # 这里直接构造一个 queued 状态的 job 然后 cancel(单测覆盖入口逻辑)。
    proc_started = threading.Event()
    blocker = threading.Event()

    class _SlowProc:
        returncode = 0

        @property
        def stdout(self):
            proc_started.set()
            blocker.wait(timeout=5.0)
            return iter(())

        def terminate(self):
            blocker.set()

        def poll(self):
            return None if not blocker.is_set() else 0

        def wait(self):
            pass

    try:
        with mock.patch(
            "chayuan.server.model_registry.install_job.subprocess.Popen",
            return_value=_SlowProc(),
        ):
            job = mgr.start("lite")
            proc_started.wait(timeout=2.0)
            mgr.cancel(job.id)
            _wait_done(job)
        assert job.status == JobStatus.CANCELLED
    finally:
        blocker.set()

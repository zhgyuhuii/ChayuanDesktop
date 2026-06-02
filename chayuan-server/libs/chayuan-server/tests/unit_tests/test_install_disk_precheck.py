"""install_model 下载前磁盘空间预检 回归测试。

行为合同
--------
1. 传入 ``expected_bytes`` 且磁盘可用空间不足(monkeypatch ``shutil.disk_usage``
   返回很小的 free)→ 不开下载,job 直接 FAILED,message 含"空间不足"人话,
   且 ``_download_*`` 从未被调用。
2. 可用空间充足 → 预检通过,正常进入下载流程(``_download_*`` 被调用)。
3. 不传 ``expected_bytes`` → 跳过预检,正常进入下载流程(即便磁盘很小)。

预检在真实下载前进行,所以用 monkeypatch 把 ``_download_modelscope`` /
``_download_huggingface`` 及下游 scan / auto-start 全 stub 掉,避免触网。
"""
import threading
from unittest.mock import patch

import pytest

import chayuan.server.model_registry.install_model as im
from chayuan.server.model_registry.install_model import (
    InstallModelJobManager,
    ModelJobStatus,
)


def _wait_done(mgr, job_id, timeout=5.0):
    """轮询等待 job 进入终态(后台线程跑完)。"""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        j = mgr.get(job_id)
        if j and j.status in (
            ModelJobStatus.SUCCEEDED,
            ModelJobStatus.FAILED,
            ModelJobStatus.CANCELLED,
        ):
            return j
        time.sleep(0.02)
    return mgr.get(job_id)


class _FakeUsage:
    def __init__(self, free):
        self.total = free * 4
        self.used = self.total - free
        self.free = free


def _stub_downloads_and_tail(monkeypatch):
    """把真实下载 + 下游 scan/manifest/auto-start 全 stub,记录是否调用过下载。"""
    called = {"download": False}

    def fake_dl(self, job, target_dir):  # noqa: ANN001, ARG001
        called["download"] = True
        with self._lock:
            job.progress_pct = 90.0

    monkeypatch.setattr(InstallModelJobManager, "_download_modelscope", fake_dl)
    monkeypatch.setattr(InstallModelJobManager, "_download_huggingface", fake_dl)
    monkeypatch.setattr(InstallModelJobManager, "_verify_runtime_match", lambda self, job: None)
    monkeypatch.setattr(im, "trigger_auto_start_for_cap", lambda cap: False)
    # scan_once / write_manifest 在 _run 里是 try/except import,缺了也无碍;
    # 但为了不真扫盘,patch local_index.scan_once。
    import chayuan.server.model_registry.local_index as li

    monkeypatch.setattr(li, "scan_once", lambda: None, raising=False)
    return called


def test_precheck_blocks_when_disk_full(tmp_path, monkeypatch):
    # 落点根指向临时目录,避免污染真实 CHAYUAN_ROOT。
    monkeypatch.setattr(im, "_user_bundled_root", lambda: tmp_path / "bundled")
    called = _stub_downloads_and_tail(monkeypatch)
    # 可用空间只剩 100MB,预估要 5GB → 必失败。
    monkeypatch.setattr(im.shutil, "disk_usage", lambda p: _FakeUsage(100 * 1024 * 1024))

    mgr = InstallModelJobManager()
    job = mgr.start(
        source="huggingface",
        model_id="BAAI/bge-m3",
        capability="text-embedding",
        expected_bytes=5 * 1024 ** 3,
    )
    done = _wait_done(mgr, job.id)
    assert done.status == ModelJobStatus.FAILED
    assert "空间不足" in (done.progress_message or "") or any(
        "空间不足" in line for line in done.log_tail
    )
    # 关键:不足时绝不开下载。
    assert called["download"] is False


def test_precheck_passes_when_disk_enough(tmp_path, monkeypatch):
    monkeypatch.setattr(im, "_user_bundled_root", lambda: tmp_path / "bundled")
    called = _stub_downloads_and_tail(monkeypatch)
    # 可用空间 100GB,预估 5GB → 充足。
    monkeypatch.setattr(im.shutil, "disk_usage", lambda p: _FakeUsage(100 * 1024 ** 3))

    mgr = InstallModelJobManager()
    job = mgr.start(
        source="huggingface",
        model_id="BAAI/bge-m3",
        capability="text-embedding",
        expected_bytes=5 * 1024 ** 3,
    )
    done = _wait_done(mgr, job.id)
    assert done.status == ModelJobStatus.SUCCEEDED
    assert called["download"] is True


def test_precheck_skipped_without_expected_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(im, "_user_bundled_root", lambda: tmp_path / "bundled")
    called = _stub_downloads_and_tail(monkeypatch)
    # 即使磁盘极小,不传 expected_bytes → 跳过预检,照常下载。
    monkeypatch.setattr(im.shutil, "disk_usage", lambda p: _FakeUsage(1 * 1024 * 1024))

    mgr = InstallModelJobManager()
    job = mgr.start(
        source="huggingface",
        model_id="BAAI/bge-m3",
        capability="text-embedding",
    )
    done = _wait_done(mgr, job.id)
    assert done.status == ModelJobStatus.SUCCEEDED
    assert called["download"] is True


def test_cleanup_removes_residual_on_failure(tmp_path, monkeypatch):
    """下载失败 + 目录本次新建 + 无 manifest → 残目录被清掉。"""
    monkeypatch.setattr(im, "_user_bundled_root", lambda: tmp_path / "bundled")
    monkeypatch.setattr(InstallModelJobManager, "_verify_runtime_match", lambda self, job: None)
    monkeypatch.setattr(im, "trigger_auto_start_for_cap", lambda cap: False)

    def boom(self, job, target_dir):  # noqa: ANN001, ARG001
        raise RuntimeError("network down")

    monkeypatch.setattr(InstallModelJobManager, "_download_modelscope", boom)
    monkeypatch.setattr(InstallModelJobManager, "_download_huggingface", boom)

    mgr = InstallModelJobManager()
    job = mgr.start(
        source="modelscope",
        model_id="BAAI/bge-m3",
        capability="text-embedding",
    )
    done = _wait_done(mgr, job.id)
    assert done.status == ModelJobStatus.FAILED
    # 残目录(本次新建、无 manifest)应被清掉。
    assert done.target_dir is not None
    import os

    assert not os.path.exists(done.target_dir)


def test_cleanup_preserves_existing_complete_model(tmp_path, monkeypatch):
    """目录非本次新建(预先存在)→ 失败时保留,不误删用户已有模型。"""
    monkeypatch.setattr(im, "_user_bundled_root", lambda: tmp_path / "bundled")
    monkeypatch.setattr(InstallModelJobManager, "_verify_runtime_match", lambda self, job: None)
    monkeypatch.setattr(im, "trigger_auto_start_for_cap", lambda cap: False)

    # 预先建好目录 + 放一个文件,模拟"已有模型"。
    pre = tmp_path / "bundled" / "embedding" / "BAAI--bge-m3"
    pre.mkdir(parents=True)
    (pre / "existing_weight.bin").write_text("data")

    def boom(self, job, target_dir):  # noqa: ANN001, ARG001
        raise RuntimeError("network down")

    monkeypatch.setattr(InstallModelJobManager, "_download_modelscope", boom)
    monkeypatch.setattr(InstallModelJobManager, "_download_huggingface", boom)

    mgr = InstallModelJobManager()
    job = mgr.start(
        source="modelscope",
        model_id="BAAI/bge-m3",
        capability="text-embedding",
    )
    done = _wait_done(mgr, job.id)
    assert done.status == ModelJobStatus.FAILED
    # 目录非本次新建 → 必须保留。
    assert pre.exists()
    assert (pre / "existing_weight.bin").exists()

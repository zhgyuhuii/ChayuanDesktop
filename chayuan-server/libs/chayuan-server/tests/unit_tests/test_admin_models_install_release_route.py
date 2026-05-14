"""``POST/GET /admin/models/install_release`` 路由集成测试。"""
from __future__ import annotations

import threading
import time
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from chayuan.server.api_server.admin_routes import admin_router
from chayuan.server.model_registry.install_job import (
    InstallJobManager,
    JobStatus,
)


class _FakeProc:
    def __init__(self, lines=("ok",), returncode=0):
        self.stdout = iter(list(lines))
        self.returncode = returncode

    def wait(self):
        pass


@pytest.fixture
def client_with_fresh_manager(monkeypatch) -> TestClient:
    """每个测试给一个全新的 InstallJobManager,避免互相污染。"""
    fresh = InstallJobManager()
    monkeypatch.setattr(
        "chayuan.server.model_registry.install_job.get_install_manager",
        lambda: fresh,
    )
    app = FastAPI()
    app.include_router(admin_router)
    return TestClient(app)


def _wait_terminal(manager_lookup, timeout: float = 2.0):
    """阻塞直到任务进 succeeded / failed。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        from chayuan.server.model_registry.install_job import get_install_manager
        for j in get_install_manager().list():
            if j.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                return
        time.sleep(0.01)


# ───────────────────────── POST /install_release ─────────────────────────


def test_post_starts_job_and_returns_job_dict(client_with_fresh_manager):
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=lambda *a, **kw: _FakeProc(),
    ):
        resp = client_with_fresh_manager.post(
            "/admin/models/install_release",
            json={"release": "lite"},
        )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["release"] == "lite"
    assert "id" in data
    assert data["status"] in ("queued", "running", "succeeded")


def test_post_400_on_unknown_release(client_with_fresh_manager):
    resp = client_with_fresh_manager.post(
        "/admin/models/install_release",
        json={"release": "ultra"},
    )
    assert resp.status_code == 400
    assert "unsupported release" in resp.text


def test_post_400_on_unknown_mirror(client_with_fresh_manager):
    resp = client_with_fresh_manager.post(
        "/admin/models/install_release",
        json={"release": "lite", "mirror": "evil-mirror"},
    )
    assert resp.status_code == 400
    assert "unknown mirror" in resp.text


def test_post_409_on_duplicate_running(client_with_fresh_manager):
    """同 release 已有运行任务应返回 409 Conflict。"""
    blocker = threading.Event()

    class _BlockingProc:
        returncode = 0

        @property
        def stdout(self):
            blocker.wait(timeout=5.0)
            return iter(())

        def wait(self):
            pass

    try:
        with mock.patch(
            "chayuan.server.model_registry.install_job.subprocess.Popen",
            return_value=_BlockingProc(),
        ):
            # 第一个请求成功
            r1 = client_with_fresh_manager.post(
                "/admin/models/install_release", json={"release": "lite"})
            assert r1.status_code == 200
            # 给后台 0.05s 进 RUNNING
            time.sleep(0.05)
            # 第二个请求 409
            r2 = client_with_fresh_manager.post(
                "/admin/models/install_release", json={"release": "lite"})
            assert r2.status_code == 409
            assert "已有运行中任务" in r2.text
    finally:
        blocker.set()


# ───────────────────────── GET /install_release/{id} ─────────────────────────


def test_get_returns_404_for_unknown_id(client_with_fresh_manager):
    resp = client_with_fresh_manager.get(
        "/admin/models/install_release/00000000-aaaa-bbbb-cccc-000000000000"
    )
    assert resp.status_code == 404


def test_get_returns_job_status(client_with_fresh_manager):
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=lambda *a, **kw: _FakeProc(("line1", "line2")),
    ):
        post = client_with_fresh_manager.post(
            "/admin/models/install_release", json={"release": "lite"})
        job_id = post.json()["data"]["id"]
        _wait_terminal(client_with_fresh_manager)
        resp = client_with_fresh_manager.get(
            f"/admin/models/install_release/{job_id}")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["id"] == job_id
    assert data["status"] == "succeeded"
    assert "log_tail" in data


# ───────────────────────── GET /install_release (list) ─────────────────────────


def test_list_returns_jobs_newest_first(client_with_fresh_manager):
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=lambda *a, **kw: _FakeProc(),
    ):
        for rel in ("lite", "standard"):
            client_with_fresh_manager.post(
                "/admin/models/install_release", json={"release": rel})
            _wait_terminal(client_with_fresh_manager)
        resp = client_with_fresh_manager.get("/admin/models/install_release")
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) >= 2
    releases = [i["release"] for i in items[:2]]
    # 最近的在前
    assert releases[0] == "standard"
    assert releases[1] == "lite"


def test_list_respects_limit(client_with_fresh_manager):
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=lambda *a, **kw: _FakeProc(),
    ):
        for rel in ("lite", "standard", "pro"):
            client_with_fresh_manager.post(
                "/admin/models/install_release", json={"release": rel})
            _wait_terminal(client_with_fresh_manager)
        resp = client_with_fresh_manager.get(
            "/admin/models/install_release", params={"limit": 2})
    items = resp.json()["data"]["items"]
    assert len(items) == 2


# ─────────────────────── POST /install_release/{id}/cancel ───────────────────────


def test_cancel_404_on_unknown_id(client_with_fresh_manager):
    resp = client_with_fresh_manager.post(
        "/admin/models/install_release/00000000-0000-0000-0000-000000000000/cancel"
    )
    assert resp.status_code == 404


def test_cancel_terminal_job_is_noop(client_with_fresh_manager):
    with mock.patch(
        "chayuan.server.model_registry.install_job.subprocess.Popen",
        side_effect=lambda *a, **kw: _FakeProc(),
    ):
        post = client_with_fresh_manager.post(
            "/admin/models/install_release", json={"release": "lite"})
        job_id = post.json()["data"]["id"]
        _wait_terminal(client_with_fresh_manager)
        resp = client_with_fresh_manager.post(
            f"/admin/models/install_release/{job_id}/cancel")
    assert resp.status_code == 200
    # 已完成的任务取消是幂等的:仍是 succeeded
    assert resp.json()["data"]["status"] == "succeeded"


def test_cancel_running_job_transitions_to_cancelled(client_with_fresh_manager):
    blocker = threading.Event()
    terminate_calls = []

    class _CancelableProc:
        returncode = -15

        @property
        def stdout(self):
            blocker.wait(timeout=5.0)
            return iter(())

        def terminate(self):
            terminate_calls.append(True)
            blocker.set()

        def poll(self):
            return None if not blocker.is_set() else -15

        def wait(self):
            pass

    try:
        with mock.patch(
            "chayuan.server.model_registry.install_job.subprocess.Popen",
            return_value=_CancelableProc(),
        ):
            post = client_with_fresh_manager.post(
                "/admin/models/install_release", json={"release": "lite"})
            job_id = post.json()["data"]["id"]
            time.sleep(0.05)  # 让任务进 RUNNING
            resp = client_with_fresh_manager.post(
                f"/admin/models/install_release/{job_id}/cancel")
            assert resp.status_code == 200
            assert terminate_calls == [True]
            _wait_terminal(client_with_fresh_manager)
            # 再查一次,应该是 cancelled
            final = client_with_fresh_manager.get(
                f"/admin/models/install_release/{job_id}")
        assert final.json()["data"]["status"] == "cancelled"
    finally:
        blocker.set()

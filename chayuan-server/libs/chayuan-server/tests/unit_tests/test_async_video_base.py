"""Unit tests for AsyncPollVideoConnector base class.

pytest-asyncio project asyncio_mode="auto" — no decorator needed on async tests.
"""
import pytest

from chayuan.server.modality.router.protocol import Capability, GenerateReq
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector,
    PollResult,
    PollStatus,
    _estimate_percent,
)


# ──────────────────────────────────────────────────────────────
# Fake subclass for testing the base class loop
# ──────────────────────────────────────────────────────────────


class _FakeConn(AsyncPollVideoConnector):
    """最小化子类:固定响应,第一次 RUNNING 第二次 SUCCEEDED。"""

    poll_interval_s = 0.0   # 消除等待,让测试秒跑
    poll_timeout_s = 5.0

    def build_submit(self, req):
        return ("http://x/submit", {}, {"prompt": req.prompt})

    def parse_submit(self, resp_json):
        return "task-123"

    def build_poll(self, req, task_id):
        return (f"http://x/{task_id}", {})

    def parse_poll(self, resp_json):
        # 第一次 RUNNING、第二次 SUCCEEDED(由实例计数器 _n 控制)
        self._n = getattr(self, "_n", 0) + 1
        if self._n < 2:
            return PollResult(status=PollStatus.RUNNING, percent=50)
        return PollResult(status=PollStatus.SUCCEEDED, video_urls=["http://x/v.mp4"])


def _req(prompt="hi"):
    return GenerateReq(
        capability=Capability.T2V,
        model="fake",
        platform_name="p",
        platform_type="p",
        api_base="http://x",
        api_key="k",
        prompt=prompt,
    )


# ──────────────────────────────────────────────────────────────
# HTTP + download stubs
# ──────────────────────────────────────────────────────────────


class _FakeResp:
    status_code = 200

    def json(self):
        return {}

    @property
    def text(self):
        return ""


async def _fake_post(self, url, **kw):
    return _FakeResp()


async def _fake_get(self, url, **kw):
    return _FakeResp()


# ──────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────


async def test_poll_loop_emits_file_and_finish(monkeypatch):
    """generate() 完整路径:提交→RUNNING→SUCCEEDED→file+finish-step。"""
    import chayuan.server.modality.router.connectors.video_gen.base_async as m

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", _fake_get)

    async def _fake_download_bytes(client, url):
        return b"FAKEMP4"

    monkeypatch.setattr(m, "_download_bytes", _fake_download_bytes)
    monkeypatch.setattr(
        m,
        "save_bytes",
        lambda b, mime: {"url": "/v1/artifacts/x.mp4", "sha256": "h", "size": len(b)},
    )

    evs = [ev async for ev in _FakeConn().generate(_req())]
    types = [e.get("type") for e in evs]

    # 必须有 file 事件
    assert "file" in types, f"expected 'file' in types, got {types}"

    # file 事件的 mediaType 必须以 video/ 开头
    assert any(
        e.get("type") == "file" and e.get("mediaType", "").startswith("video/")
        for e in evs
    ), f"no file event with video/ mediaType in {evs}"

    # 必须有 finish-step
    assert "finish-step" in types, f"expected 'finish-step' in types, got {types}"


async def test_empty_prompt_yields_error(monkeypatch):
    """空 prompt 直接 yield error,不发请求。"""
    import chayuan.server.modality.router.connectors.video_gen.base_async as m

    called = []
    monkeypatch.setattr(
        "httpx.AsyncClient.post",
        lambda self, url, **kw: called.append(url) or _fake_post(self, url, **kw),
    )

    evs = [ev async for ev in _FakeConn().generate(_req(prompt=""))]
    types = [e.get("type") for e in evs]
    assert "error" in types
    assert not called, "should not have called POST for empty prompt"


async def test_text_start_and_text_delta_emitted(monkeypatch):
    """generate() 开头必须 yield text-start / text-delta / text-end。"""
    import chayuan.server.modality.router.connectors.video_gen.base_async as m

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", _fake_get)
    monkeypatch.setattr(m, "_download_bytes", lambda client, url: b"V")
    monkeypatch.setattr(
        m,
        "save_bytes",
        lambda b, mime: {"url": "/v1/artifacts/x.mp4", "sha256": "h", "size": 1},
    )

    evs = [ev async for ev in _FakeConn().generate(_req())]
    types = [e.get("type") for e in evs]
    assert "text-start" in types
    assert "text-delta" in types
    assert "text-end" in types


async def test_task_progress_events_emitted(monkeypatch):
    """generate() 必须 yield data-task-progress 事件。"""
    import chayuan.server.modality.router.connectors.video_gen.base_async as m

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", _fake_get)
    monkeypatch.setattr(m, "_download_bytes", lambda client, url: b"V")
    monkeypatch.setattr(
        m,
        "save_bytes",
        lambda b, mime: {"url": "/v1/artifacts/x.mp4", "sha256": "h", "size": 1},
    )

    evs = [ev async for ev in _FakeConn().generate(_req())]
    types = [e.get("type") for e in evs]
    assert "data-task-progress" in types


async def test_cancelled_yields_error(monkeypatch):
    """req.cancelled.is_set() → yield error + stop。"""
    import chayuan.server.modality.router.connectors.video_gen.base_async as m
    from chayuan.server.modality.router.protocol import Cancelled

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", _fake_get)
    monkeypatch.setattr(m, "_download_bytes", lambda client, url: b"V")
    monkeypatch.setattr(
        m,
        "save_bytes",
        lambda b, mime: {"url": "/v1/artifacts/x.mp4", "sha256": "h", "size": 1},
    )

    cancel = Cancelled()
    cancel.set()  # 已取消

    req = GenerateReq(
        capability=Capability.T2V,
        model="fake",
        platform_name="p",
        platform_type="p",
        api_base="http://x",
        api_key="k",
        prompt="test",
        cancelled=cancel,
    )

    evs = [ev async for ev in _FakeConn().generate(req)]
    types = [e.get("type") for e in evs]
    # 应该在进入 _poll_loop 后立即遇到取消信号并 yield error
    assert "error" in types
    error_evs = [e for e in evs if e.get("type") == "error"]
    assert any("取消" in (e.get("errorText") or "") for e in error_evs)


# ──────────────────────────────────────────────────────────────
# _estimate_percent 算法对齐 dashscope
# ──────────────────────────────────────────────────────────────


def test_estimate_percent_pending():
    assert _estimate_percent(0, "PENDING") == 0
    assert _estimate_percent(3, "PENDING") == 6
    assert _estimate_percent(10, "PENDING") == 10   # capped at 10


def test_estimate_percent_running():
    # 25 + int(0 / 0.7) = 25
    assert _estimate_percent(0, "RUNNING") == 25
    # 25 + int(45.5 / 0.7) = 25 + 65 = 90 (capped)
    assert _estimate_percent(100, "RUNNING") == 90


def test_estimate_percent_other():
    assert _estimate_percent(100, "UNKNOWN") == 0
    assert _estimate_percent(100, "FAILED") == 0

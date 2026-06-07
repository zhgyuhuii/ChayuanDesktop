"""Unit tests for DashScopeT2VConnector refactored as AsyncPollVideoConnector subclass.

Covers:
  - build_submit: T2V (no img_url) and I2V (with img_url), headers, url shape
  - parse_submit: extracts task_id from nested output
  - build_poll: url construction, auth header
  - parse_poll: SUCCEEDED (with video_url), FAILED (with message), PENDING, RUNNING,
    CANCELED, UNKNOWN

pytest-asyncio project asyncio_mode="auto" — no decorator needed on async tests.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import List
from unittest.mock import MagicMock

import pytest

from chayuan.server.modality.router.connectors.video_gen.base_async import (
    PollResult,
    PollStatus,
)
from chayuan.server.modality.router.connectors.video_gen.dashscope import (
    DashScopeT2VConnector,
)
from chayuan.server.modality.router.protocol import GenerateReq


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────


def _make_req(
    *,
    prompt: str = "a red fox running",
    model: str = "wanx2.1-t2v-turbo",
    api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: str = "sk-test-key",
    params: dict | None = None,
    attachments: list | None = None,
) -> GenerateReq:
    return GenerateReq(
        prompt=prompt,
        model=model,
        api_base=api_base,
        api_key=api_key,
        params=params or {},
        attachments=attachments or [],
    )


def _make_attachment(mime: str, url: str) -> object:
    a = MagicMock()
    a.mime = mime
    a.url = url
    return a


_CONN = DashScopeT2VConnector()


# ──────────────────────────────────────────────────────────────
# build_submit
# ──────────────────────────────────────────────────────────────


class TestBuildSubmit:
    def test_t2v_url_contains_video_synthesis(self):
        req = _make_req()
        url, headers, body = _CONN.build_submit(req)
        assert "video-synthesis" in url

    def test_t2v_url_strips_compatible_mode(self):
        req = _make_req(api_base="https://dashscope.aliyuncs.com/compatible-mode/v1")
        url, _, _ = _CONN.build_submit(req)
        assert "compatible-mode" not in url
        assert "/api/v1/services/aigc/video-generation/video-synthesis" in url

    def test_t2v_headers_contain_async_enable(self):
        req = _make_req()
        _, headers, _ = _CONN.build_submit(req)
        assert headers.get("X-DashScope-Async") == "enable"

    def test_t2v_headers_contain_authorization(self):
        req = _make_req(api_key="sk-abc")
        _, headers, _ = _CONN.build_submit(req)
        assert headers.get("Authorization") == "Bearer sk-abc"

    def test_t2v_headers_contain_content_type_json(self):
        req = _make_req()
        _, headers, _ = _CONN.build_submit(req)
        assert headers.get("Content-Type") == "application/json"

    def test_t2v_body_no_img_url(self):
        req = _make_req(prompt="a red fox")
        _, _, body = _CONN.build_submit(req)
        assert "img_url" not in body.get("input", {})
        assert body["input"]["prompt"] == "a red fox"

    def test_t2v_body_model_field(self):
        req = _make_req(model="wanx2.1-t2v-turbo")
        _, _, body = _CONN.build_submit(req)
        assert body["model"] == "wanx2.1-t2v-turbo"

    def test_t2v_body_default_size(self):
        req = _make_req()
        _, _, body = _CONN.build_submit(req)
        assert body["parameters"]["size"] == "1280*720"

    def test_i2v_img_url_injected(self):
        attachment = _make_attachment(mime="image/jpeg", url="http://host/img.jpg")
        req = _make_req(attachments=[attachment])
        _, _, body = _CONN.build_submit(req)
        assert body["input"].get("img_url") == "http://host/img.jpg"

    def test_i2v_non_image_attachment_ignored(self):
        attachment = _make_attachment(mime="text/plain", url="http://host/doc.txt")
        req = _make_req(attachments=[attachment])
        _, _, body = _CONN.build_submit(req)
        assert "img_url" not in body.get("input", {})

    def test_custom_size_and_duration(self):
        req = _make_req(params={"size": "720*1280", "duration": 8})
        _, _, body = _CONN.build_submit(req)
        assert body["parameters"]["size"] == "720*1280"
        assert body["parameters"]["duration"] == 8

    def test_seed_included_when_provided(self):
        req = _make_req(params={"seed": "42"})
        _, _, body = _CONN.build_submit(req)
        assert body["parameters"]["seed"] == 42


# ──────────────────────────────────────────────────────────────
# parse_submit
# ──────────────────────────────────────────────────────────────


class TestParseSubmit:
    def test_extracts_task_id(self):
        resp = {"output": {"task_id": "task-abc123", "task_status": "PENDING"}}
        assert _CONN.parse_submit(resp) == "task-abc123"

    def test_missing_output_returns_empty(self):
        assert _CONN.parse_submit({}) == ""

    def test_missing_task_id_returns_empty(self):
        assert _CONN.parse_submit({"output": {}}) == ""

    def test_null_output_returns_empty(self):
        assert _CONN.parse_submit({"output": None}) == ""


# ──────────────────────────────────────────────────────────────
# build_poll
# ──────────────────────────────────────────────────────────────


class TestBuildPoll:
    def test_poll_url_contains_task_id(self):
        req = _make_req()
        url, _ = _CONN.build_poll(req, "task-xyz")
        assert url.endswith("/task-xyz")

    def test_poll_url_contains_tasks_path(self):
        req = _make_req(api_base="https://dashscope.aliyuncs.com/compatible-mode/v1")
        url, _ = _CONN.build_poll(req, "task-xyz")
        assert "/api/v1/tasks/task-xyz" in url

    def test_poll_headers_contain_authorization(self):
        req = _make_req(api_key="sk-poll-key")
        _, headers = _CONN.build_poll(req, "task-xyz")
        assert headers.get("Authorization") == "Bearer sk-poll-key"


# ──────────────────────────────────────────────────────────────
# parse_poll
# ──────────────────────────────────────────────────────────────


class TestParsePoll:
    def test_succeeded_status(self):
        resp = {
            "output": {
                "task_status": "SUCCEEDED",
                "video_url": "https://cdn.example.com/video.mp4",
            }
        }
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.SUCCEEDED
        assert result.video_urls == ["https://cdn.example.com/video.mp4"]

    def test_succeeded_no_video_url_gives_empty_list(self):
        resp = {"output": {"task_status": "SUCCEEDED"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.SUCCEEDED
        assert result.video_urls == []

    def test_failed_status_with_message(self):
        resp = {
            "output": {
                "task_status": "FAILED",
                "message": "quota exceeded",
            }
        }
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.FAILED
        assert result.error_message == "quota exceeded"

    def test_failed_status_no_message(self):
        resp = {"output": {"task_status": "FAILED"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.FAILED
        assert result.error_message is None

    def test_pending_status(self):
        resp = {"output": {"task_status": "PENDING"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.PENDING

    def test_running_status(self):
        resp = {"output": {"task_status": "RUNNING"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.RUNNING

    def test_canceled_status(self):
        resp = {"output": {"task_status": "CANCELED"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.CANCELED

    def test_unknown_status(self):
        resp = {"output": {"task_status": "SOMETHING_WEIRD"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.UNKNOWN

    def test_empty_output_gives_unknown(self):
        result = _CONN.parse_poll({})
        assert result.status == PollStatus.UNKNOWN

    def test_lowercase_status_mapped_correctly(self):
        # DashScope returns uppercase, but parse_poll does .upper() so lowercase is ok
        resp = {"output": {"task_status": "succeeded", "video_url": "http://x/v.mp4"}}
        result = _CONN.parse_poll(resp)
        assert result.status == PollStatus.SUCCEEDED

    def test_null_output_gives_unknown(self):
        result = _CONN.parse_poll({"output": None})
        assert result.status == PollStatus.UNKNOWN

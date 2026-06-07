"""Unit tests for ZhipuVideoConnector (CogVideoX).

Tests cover:
  - build_submit: T2V (no image_url) / I2V (with image_url), URL contains videos/generations, Bearer header
  - parse_submit: extracts task_id from top-level "id"
  - build_poll: URL contains async-result/{task_id}, Bearer header
  - parse_poll: SUCCESS -> SUCCEEDED + video_result[0].url / PROCESSING -> RUNNING / FAIL -> FAILED

NOTE: pytest not run (sandbox lacks py312), only ast.parse syntax check performed.
"""
from __future__ import annotations

import pytest

from chayuan.server.modality.router.protocol import Attachment, Capability, GenerateReq
from chayuan.server.modality.router.connectors.video_gen.zhipu import (
    ZhipuVideoConnector,
)
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    PollResult,
    PollStatus,
)


# ---- helpers ----

def _req(
    prompt="test prompt",
    attachments=None,
    params=None,
    api_base="",
    api_key="test-zhipu-api-key",
):
    return GenerateReq(
        capability=Capability.T2V,
        model="cogvideox-flash",
        platform_name="zhipu-test",
        platform_type="zhipu",
        api_base=api_base,
        api_key=api_key,
        prompt=prompt,
        attachments=attachments or [],
        params=params or {},
    )


def _conn():
    return ZhipuVideoConnector()


# ---- build_submit ----

class TestBuildSubmit:

    def test_t2v_url_contains_videos_generations(self):
        url, _, _ = _conn().build_submit(_req())
        assert "videos/generations" in url

    def test_t2v_no_image_url_in_body(self):
        _, _, body = _conn().build_submit(_req())
        assert "image_url" not in body

    def test_t2v_body_has_model_and_prompt(self):
        _, _, body = _conn().build_submit(_req(prompt="blue sky"))
        assert body["model"] == "cogvideox-flash"
        assert body["prompt"] == "blue sky"

    def test_t2v_bearer_header(self):
        _, headers, _ = _conn().build_submit(_req(api_key="my-key"))
        assert headers["Authorization"] == "Bearer my-key"
        assert headers["Content-Type"] == "application/json"

    def test_i2v_image_url_in_body(self):
        att = Attachment(mime="image/png", url="https://example.com/photo.png")
        _, _, body = _conn().build_submit(_req(attachments=[att]))
        assert body.get("image_url") == "https://example.com/photo.png"

    def test_i2v_non_image_attachment_skipped(self):
        att = Attachment(mime="video/mp4", url="https://example.com/video.mp4")
        _, _, body = _conn().build_submit(_req(attachments=[att]))
        assert "image_url" not in body

    def test_optional_params_passthrough(self):
        params = {"size": "1280x720", "duration": 5, "with_audio": True}
        _, _, body = _conn().build_submit(_req(params=params))
        assert body["size"] == "1280x720"
        assert body["duration"] == 5
        assert body["with_audio"] is True

    def test_absent_optional_params_not_in_body(self):
        _, _, body = _conn().build_submit(_req(params={}))
        for key in ("size", "duration", "quality", "fps", "with_audio"):
            assert key not in body

    def test_default_base_url(self):
        url, _, _ = _conn().build_submit(_req(api_base=""))
        assert "open.bigmodel.cn" in url

    def test_custom_api_base(self):
        url, _, _ = _conn().build_submit(_req(api_base="https://custom.example.com/v1"))
        assert url.startswith("https://custom.example.com/v1")

    def test_trailing_slash_stripped(self):
        url, _, _ = _conn().build_submit(_req(api_base="https://open.bigmodel.cn/api/paas/v4/"))
        assert "//" not in url.split("://", 1)[-1]


# ---- parse_submit ----

class TestParseSubmit:

    def test_returns_id(self):
        assert _conn().parse_submit({"id": "task-abc-123"}) == "task-abc-123"

    def test_empty_dict_returns_empty_string(self):
        assert _conn().parse_submit({}) == ""

    def test_none_returns_empty_string(self):
        assert _conn().parse_submit(None) == ""

    def test_id_none_returns_empty_string(self):
        assert _conn().parse_submit({"id": None}) == ""


# ---- build_poll ----

class TestBuildPoll:

    def test_url_contains_task_id(self):
        url, _ = _conn().build_poll(_req(), "my-task-999")
        assert "async-result/my-task-999" in url

    def test_bearer_header(self):
        _, headers = _conn().build_poll(_req(api_key="poll-key"), "t123")
        assert headers["Authorization"] == "Bearer poll-key"


# ---- parse_poll ----

class TestParsePoll:

    def test_success_with_video_url(self):
        resp = {
            "task_status": "SUCCESS",
            "video_result": [{"url": "https://cdn.zhipu.ai/output.mp4"}],
        }
        pr = _conn().parse_poll(resp)
        assert pr.status == PollStatus.SUCCEEDED
        assert pr.video_urls == ["https://cdn.zhipu.ai/output.mp4"]

    def test_success_empty_video_result(self):
        pr = _conn().parse_poll({"task_status": "SUCCESS", "video_result": []})
        assert pr.status == PollStatus.SUCCEEDED
        assert pr.video_urls == []

    def test_success_missing_url_key(self):
        pr = _conn().parse_poll({"task_status": "SUCCESS", "video_result": [{"cover_image_url": "x"}]})
        assert pr.status == PollStatus.SUCCEEDED
        assert pr.video_urls == []

    def test_processing_returns_running(self):
        pr = _conn().parse_poll({"task_status": "PROCESSING"})
        assert pr.status == PollStatus.RUNNING

    def test_fail_with_error_message(self):
        resp = {"task_status": "FAIL", "error": {"code": "ERR", "message": "timed out"}}
        pr = _conn().parse_poll(resp)
        assert pr.status == PollStatus.FAILED
        assert pr.error_message == "timed out"

    def test_fail_falls_back_to_code(self):
        resp = {"task_status": "FAIL", "error": {"code": "INTERNAL_ERROR"}}
        pr = _conn().parse_poll(resp)
        assert pr.status == PollStatus.FAILED
        assert pr.error_message == "INTERNAL_ERROR"

    def test_fail_no_error_field(self):
        pr = _conn().parse_poll({"task_status": "FAIL"})
        assert pr.status == PollStatus.FAILED
        assert pr.error_message  # non-empty default

    def test_unknown_status(self):
        pr = _conn().parse_poll({"task_status": "QUEUED"})
        assert pr.status == PollStatus.UNKNOWN

    def test_none_response(self):
        pr = _conn().parse_poll(None)
        assert pr.status == PollStatus.UNKNOWN

    def test_empty_response(self):
        pr = _conn().parse_poll({})
        assert pr.status == PollStatus.UNKNOWN


# ---- registration ----

class TestRegistration:

    def test_capability(self):
        assert ZhipuVideoConnector.capability == Capability.T2V

    def test_platform_type(self):
        assert ZhipuVideoConnector.platform_type == "zhipu"

    def test_get_connector(self):
        from chayuan.server.modality.router.connectors.base import get_connector
        cls = get_connector(Capability.T2V, "zhipu")
        assert cls is ZhipuVideoConnector

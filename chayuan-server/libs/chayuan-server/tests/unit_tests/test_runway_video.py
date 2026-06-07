"""Runway 视频连接器单元测试。

覆盖：
  - build_submit: T2V（url 结尾 text_to_video，无 promptImage）
  - build_submit: I2V（url 结尾 image_to_video，body 含 promptImage=att.url）
  - build_submit: 请求头含 X-Runway-Version
  - parse_submit: 从 resp 中取 id
  - parse_poll: SUCCEEDED → output[0] → PollResult(SUCCEEDED, video_urls)
  - parse_poll: RUNNING / PENDING / THROTTLED → PollResult(RUNNING)
  - parse_poll: FAILED / CANCELED → PollResult(FAILED)

注意：pytest 未在当前沙箱运行（无 py312 conda 环境），测试仅经过 ast.parse 语法检查。
"""

from __future__ import annotations

import pytest

from chayuan.server.modality.router.connectors.video_gen.base_async import (
    PollStatus,
)
from chayuan.server.modality.router.connectors.video_gen.runway import (
    RunwayVideoConnector,
)
from chayuan.server.modality.router.protocol import Attachment, Capability, GenerateReq


# ──────────────────────────────────────────────────────────────
# 测试工具
# ──────────────────────────────────────────────────────────────


def _make_req(
    model: str = "gen4_turbo",
    prompt: str = "a sunny beach",
    api_key: str = "test-api-key",
    api_base: str = "",
    attachments: list | None = None,
    params: dict | None = None,
) -> GenerateReq:
    """构造最小 GenerateReq，便于各测试复用。"""
    return GenerateReq(
        capability=Capability.T2V,
        model=model,
        platform_name="runway",
        platform_type="runway",
        api_base=api_base,
        api_key=api_key,
        prompt=prompt,
        attachments=attachments or [],
        params=params or {},
    )


# ──────────────────────────────────────────────────────────────
# build_submit — T2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_t2v_url_ends_with_text_to_video() -> None:
    """T2V 时 url 应以 /v1/text_to_video 结尾。"""
    connector = RunwayVideoConnector()
    req = _make_req()
    url, headers, body = connector.build_submit(req)
    assert url.endswith("/v1/text_to_video"), f"unexpected url: {url}"


def test_build_submit_t2v_no_prompt_image() -> None:
    """T2V 时 body 不应包含 promptImage 字段。"""
    connector = RunwayVideoConnector()
    req = _make_req()
    _, _, body = connector.build_submit(req)
    assert "promptImage" not in body


def test_build_submit_t2v_body_has_model_and_prompt_text() -> None:
    """T2V body 应含 model 和 promptText 字段。"""
    connector = RunwayVideoConnector()
    req = _make_req(model="gen4_turbo", prompt="sunrise over mountains")
    _, _, body = connector.build_submit(req)
    assert body["model"] == "gen4_turbo"
    assert body["promptText"] == "sunrise over mountains"


def test_build_submit_uses_default_base_when_api_base_empty() -> None:
    """api_base 为空时应使用默认 Runway 端点。"""
    connector = RunwayVideoConnector()
    req = _make_req(api_base="")
    url, _, _ = connector.build_submit(req)
    assert "api.dev.runwayml.com" in url


def test_build_submit_uses_custom_api_base() -> None:
    """api_base 非空时应使用自定义端点。"""
    connector = RunwayVideoConnector()
    req = _make_req(api_base="https://custom.runway.example.com")
    url, _, _ = connector.build_submit(req)
    assert url.startswith("https://custom.runway.example.com")


def test_build_submit_optional_params_forwarded() -> None:
    """ratio / duration 在 params 中提供时应透传到 body。"""
    connector = RunwayVideoConnector()
    req = _make_req(params={"ratio": "16:9", "duration": 5})
    _, _, body = connector.build_submit(req)
    assert body.get("ratio") == "16:9"
    assert body.get("duration") == 5


def test_build_submit_optional_params_not_included_when_absent() -> None:
    """ratio / duration 不在 params 中时不应出现在 body 里。"""
    connector = RunwayVideoConnector()
    req = _make_req(params={})
    _, _, body = connector.build_submit(req)
    assert "ratio" not in body
    assert "duration" not in body


# ──────────────────────────────────────────────────────────────
# build_submit — I2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_i2v_url_ends_with_image_to_video() -> None:
    """I2V 时 url 应以 /v1/image_to_video 结尾。"""
    connector = RunwayVideoConnector()
    att = Attachment(mime="image/jpeg", url="https://example.com/frame.jpg")
    req = _make_req(attachments=[att])
    url, _, _ = connector.build_submit(req)
    assert url.endswith("/v1/image_to_video"), f"unexpected url: {url}"


def test_build_submit_i2v_body_has_prompt_image() -> None:
    """I2V 时 body 应含 promptImage 字段，值为附件 url。"""
    connector = RunwayVideoConnector()
    att = Attachment(mime="image/png", url="https://cdn.example.com/img.png")
    req = _make_req(attachments=[att])
    _, _, body = connector.build_submit(req)
    assert body.get("promptImage") == "https://cdn.example.com/img.png"


def test_build_submit_i2v_uses_first_image_attachment_only() -> None:
    """I2V 只取第一个 image/* 附件，忽略后续附件。"""
    connector = RunwayVideoConnector()
    att1 = Attachment(mime="image/jpeg", url="https://example.com/first.jpg")
    att2 = Attachment(mime="image/jpeg", url="https://example.com/second.jpg")
    req = _make_req(attachments=[att1, att2])
    _, _, body = connector.build_submit(req)
    assert body.get("promptImage") == "https://example.com/first.jpg"


def test_build_submit_non_image_attachment_treated_as_t2v() -> None:
    """非 image/* 附件不触发 I2V，仍走 T2V endpoint。"""
    connector = RunwayVideoConnector()
    att = Attachment(mime="text/plain", url="https://example.com/doc.txt")
    req = _make_req(attachments=[att])
    url, _, body = connector.build_submit(req)
    assert url.endswith("/v1/text_to_video")
    assert "promptImage" not in body


# ──────────────────────────────────────────────────────────────
# build_submit — 请求头
# ──────────────────────────────────────────────────────────────


def test_build_submit_headers_contain_x_runway_version() -> None:
    """请求头应含 X-Runway-Version 字段。"""
    connector = RunwayVideoConnector()
    req = _make_req(api_key="my-secret-key")
    _, headers, _ = connector.build_submit(req)
    assert "X-Runway-Version" in headers
    assert headers["X-Runway-Version"]  # 非空


def test_build_submit_headers_contain_bearer_token() -> None:
    """请求头 Authorization 应为 'Bearer {api_key}'。"""
    connector = RunwayVideoConnector()
    req = _make_req(api_key="rw-test-123")
    _, headers, _ = connector.build_submit(req)
    assert headers.get("Authorization") == "Bearer rw-test-123"


def test_build_submit_headers_content_type_json() -> None:
    """请求头 Content-Type 应为 application/json。"""
    connector = RunwayVideoConnector()
    req = _make_req()
    _, headers, _ = connector.build_submit(req)
    assert headers.get("Content-Type") == "application/json"


# ──────────────────────────────────────────────────────────────
# build_poll
# ──────────────────────────────────────────────────────────────


def test_build_poll_url_contains_task_id() -> None:
    """轮询 url 应包含 task_id 和 /v1/tasks/ 路径。"""
    connector = RunwayVideoConnector()
    req = _make_req()
    url, headers = connector.build_poll(req, "task-abc-123")
    assert "task-abc-123" in url
    assert "/v1/tasks/" in url


def test_build_poll_headers_contain_x_runway_version() -> None:
    """轮询请求头同样应含 X-Runway-Version。"""
    connector = RunwayVideoConnector()
    req = _make_req()
    _, headers = connector.build_poll(req, "task-xyz")
    assert "X-Runway-Version" in headers


# ──────────────────────────────────────────────────────────────
# parse_submit
# ──────────────────────────────────────────────────────────────


def test_parse_submit_returns_id_field() -> None:
    """parse_submit 应从顶层 id 字段取 task id。"""
    connector = RunwayVideoConnector()
    resp = {"id": "task-runway-42", "status": "PENDING"}
    assert connector.parse_submit(resp) == "task-runway-42"


def test_parse_submit_returns_empty_string_when_no_id() -> None:
    """parse_submit 在响应无 id 时应返回空字符串。"""
    connector = RunwayVideoConnector()
    assert connector.parse_submit({}) == ""
    assert connector.parse_submit(None) == ""  # type: ignore[arg-type]


# ──────────────────────────────────────────────────────────────
# parse_poll — SUCCEEDED
# ──────────────────────────────────────────────────────────────


def test_parse_poll_succeeded_returns_succeeded_status() -> None:
    """SUCCEEDED 状态应返回 PollResult(SUCCEEDED)。"""
    connector = RunwayVideoConnector()
    resp = {
        "status": "SUCCEEDED",
        "output": ["https://cdn.runwayml.com/video/abc.mp4"],
    }
    result = connector.parse_poll(resp)
    assert result.status == PollStatus.SUCCEEDED


def test_parse_poll_succeeded_video_urls_from_output() -> None:
    """SUCCEEDED 时 video_urls 应取 output 列表内容。"""
    connector = RunwayVideoConnector()
    video_url = "https://cdn.runwayml.com/video/abc.mp4"
    resp = {"status": "SUCCEEDED", "output": [video_url]}
    result = connector.parse_poll(resp)
    assert result.video_urls == [video_url]


def test_parse_poll_succeeded_empty_output_gives_empty_video_urls() -> None:
    """SUCCEEDED 但 output 为空列表时，video_urls 也为空。"""
    connector = RunwayVideoConnector()
    resp = {"status": "SUCCEEDED", "output": []}
    result = connector.parse_poll(resp)
    assert result.status == PollStatus.SUCCEEDED
    assert result.video_urls == []


def test_parse_poll_succeeded_multiple_outputs() -> None:
    """output 有多个 URL 时，video_urls 包含全部有效 URL。"""
    connector = RunwayVideoConnector()
    resp = {
        "status": "SUCCEEDED",
        "output": ["https://cdn.runwayml.com/v1.mp4", "https://cdn.runwayml.com/v2.mp4"],
    }
    result = connector.parse_poll(resp)
    assert len(result.video_urls) == 2


# ──────────────────────────────────────────────────────────────
# parse_poll — RUNNING / PENDING / THROTTLED
# ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["RUNNING", "PENDING", "THROTTLED"])
def test_parse_poll_running_statuses(status: str) -> None:
    """RUNNING / PENDING / THROTTLED 状态应映射为 PollResult(RUNNING)。"""
    connector = RunwayVideoConnector()
    resp = {"status": status}
    result = connector.parse_poll(resp)
    assert result.status == PollStatus.RUNNING


# ──────────────────────────────────────────────────────────────
# parse_poll — FAILED / CANCELED
# ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["FAILED", "CANCELED"])
def test_parse_poll_failed_statuses(status: str) -> None:
    """FAILED / CANCELED 状态应映射为 PollResult(FAILED)。"""
    connector = RunwayVideoConnector()
    resp = {"status": status}
    result = connector.parse_poll(resp)
    assert result.status == PollStatus.FAILED


def test_parse_poll_failed_includes_error_message() -> None:
    """FAILED 时应从 failure 字段取错误信息。"""
    connector = RunwayVideoConnector()
    resp = {"status": "FAILED", "failure": "Content policy violation"}
    result = connector.parse_poll(resp)
    assert result.status == PollStatus.FAILED
    assert result.error_message == "Content policy violation"


# ──────────────────────────────────────────────────────────────
# parse_poll — UNKNOWN
# ──────────────────────────────────────────────────────────────


def test_parse_poll_unknown_status() -> None:
    """未知状态字符串应映射为 PollResult(UNKNOWN)。"""
    connector = RunwayVideoConnector()
    resp = {"status": "SOMETHING_UNEXPECTED"}
    result = connector.parse_poll(resp)
    assert result.status == PollStatus.UNKNOWN


def test_parse_poll_empty_response() -> None:
    """空响应应映射为 PollResult(UNKNOWN)。"""
    connector = RunwayVideoConnector()
    result = connector.parse_poll({})
    assert result.status == PollStatus.UNKNOWN

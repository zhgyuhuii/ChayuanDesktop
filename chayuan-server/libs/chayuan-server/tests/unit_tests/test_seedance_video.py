"""Unit tests for SeedanceVideoConnector (字节 即梦 Seedance, 火山引擎 Ark).

Tests cover the 4 hook methods only — no network calls, no asyncio loops.
pytest-asyncio project asyncio_mode="auto".
"""

from chayuan.server.modality.router.protocol import (
    Attachment,
    Capability,
    GenerateReq,
)
from chayuan.server.modality.router.connectors.video_gen.seedance import (
    SeedanceVideoConnector,
)
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    PollStatus,
)


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

_CONN = SeedanceVideoConnector()

_DEFAULT_BASE_EXPECTED = "https://ark.cn-beijing.volces.com/api/v3"


def _t2v_req(
    prompt: str = "a futuristic city at night",
    api_base: str = "",
    api_key: str = "test-api-key",
    model: str = "seedance-1-lite",
    params: dict | None = None,
) -> GenerateReq:
    return GenerateReq(
        capability=Capability.T2V,
        model=model,
        platform_name="volcengine-test",
        platform_type="volcengine",
        api_base=api_base,
        api_key=api_key,
        prompt=prompt,
        params=params or {},
    )


def _i2v_req(
    image_url: str = "https://example.com/ref.jpg",
    prompt: str = "animate this image",
    api_key: str = "test-api-key",
) -> GenerateReq:
    return GenerateReq(
        capability=Capability.T2V,
        model="seedance-1-lite",
        platform_name="volcengine-test",
        platform_type="volcengine",
        api_base="",
        api_key=api_key,
        prompt=prompt,
        attachments=[
            Attachment(mime="image/jpeg", url=image_url, name="ref.jpg")
        ],
    )


# ──────────────────────────────────────────────────────────────
# build_submit — T2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_t2v_content_has_only_text():
    """T2V 时 content 列表只含一个 text 条目，不含 image_url。"""
    req = _t2v_req()
    url, headers, body = _CONN.build_submit(req)

    assert body["model"] == "seedance-1-lite"
    content = body["content"]
    assert len(content) == 1
    assert content[0]["type"] == "text"
    assert content[0]["text"] == req.prompt

    # 确认没有 image_url 条目
    assert all(c.get("type") != "image_url" for c in content)


def test_build_submit_t2v_url_contains_generations_tasks():
    """提交 URL 包含 /contents/generations/tasks。"""
    req = _t2v_req()
    url, headers, body = _CONN.build_submit(req)

    assert "generations/tasks" in url
    assert url.startswith(_DEFAULT_BASE_EXPECTED)


def test_build_submit_t2v_bearer_auth():
    """headers 含 Authorization: Bearer <api_key>。"""
    req = _t2v_req(api_key="my-secret-key")
    _, headers, _ = _CONN.build_submit(req)

    assert headers.get("Authorization") == "Bearer my-secret-key"
    assert headers.get("Content-Type") == "application/json"


def test_build_submit_custom_api_base():
    """api_base 非空时用自定义 base，并去掉尾斜杠。"""
    req = _t2v_req(api_base="https://my-custom-endpoint.example.com/v3/")
    url, _, _ = _CONN.build_submit(req)

    assert url.startswith("https://my-custom-endpoint.example.com/v3")
    assert "my-custom-endpoint.example.com/v3/" not in url  # 尾斜杠已去除


def test_build_submit_optional_params_passed_through():
    """req.params 中的可选字段透传到 body。"""
    req = _t2v_req(
        params={
            "ratio": "16:9",
            "duration": 5,
            "generate_audio": True,
        }
    )
    _, _, body = _CONN.build_submit(req)

    assert body.get("ratio") == "16:9"
    assert body.get("duration") == 5
    assert body.get("generate_audio") is True


def test_build_submit_missing_optional_params_not_in_body():
    """req.params 里没有的可选字段不应出现在 body 里。"""
    req = _t2v_req(params={})
    _, _, body = _CONN.build_submit(req)

    for key in ("ratio", "resolution", "duration", "generate_audio", "watermark"):
        assert key not in body, f"unexpected key {key!r} in body"


# ──────────────────────────────────────────────────────────────
# build_submit — I2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_i2v_content_contains_image_url():
    """I2V 时 content 列表含 image_url 条目，且 url 与附件 url 一致。"""
    image_url = "https://example.com/ref.jpg"
    req = _i2v_req(image_url=image_url)
    url, headers, body = _CONN.build_submit(req)

    content = body["content"]
    # 至少有 text + image_url 两个条目
    assert len(content) >= 2

    image_entries = [c for c in content if c.get("type") == "image_url"]
    assert len(image_entries) == 1

    img_entry = image_entries[0]
    assert img_entry["image_url"]["url"] == image_url


def test_build_submit_i2v_url_still_points_to_generations_tasks():
    """I2V 提交 URL 仍然指向 /contents/generations/tasks（不分 t2v/i2v 子路径）。"""
    req = _i2v_req()
    url, _, _ = _CONN.build_submit(req)

    assert "generations/tasks" in url


# ──────────────────────────────────────────────────────────────
# parse_submit
# ──────────────────────────────────────────────────────────────


def test_parse_submit_extracts_id():
    """parse_submit 从顶层 id 字段取 task id。"""
    resp = {"id": "task-abc-123", "status": "queued"}
    assert _CONN.parse_submit(resp) == "task-abc-123"


def test_parse_submit_empty_resp_returns_empty_string():
    """resp_json 为 None 或空 dict 时返回空字符串，不抛异常。"""
    assert _CONN.parse_submit(None) == ""  # type: ignore[arg-type]
    assert _CONN.parse_submit({}) == ""


def test_parse_submit_no_id_returns_empty_string():
    """响应中无 id 字段时返回空字符串。"""
    assert _CONN.parse_submit({"status": "queued"}) == ""


# ──────────────────────────────────────────────────────────────
# build_poll
# ──────────────────────────────────────────────────────────────


def test_build_poll_url_contains_task_id():
    """轮询 URL 包含 task_id。"""
    req = _t2v_req()
    url, headers = _CONN.build_poll(req, "task-xyz-999")

    assert "task-xyz-999" in url
    assert "generations/tasks" in url


def test_build_poll_bearer_auth():
    """轮询 headers 含 Authorization: Bearer <api_key>。"""
    req = _t2v_req(api_key="poll-key")
    _, headers = _CONN.build_poll(req, "task-xyz-999")

    assert headers.get("Authorization") == "Bearer poll-key"


# ──────────────────────────────────────────────────────────────
# parse_poll — SUCCEEDED
# ──────────────────────────────────────────────────────────────


def test_parse_poll_succeeded_returns_succeeded_status():
    """status=succeeded 时返回 PollStatus.SUCCEEDED。"""
    resp = {
        "id": "task-abc",
        "status": "succeeded",
        "content": {
            "video_url": "https://cdn.example.com/output.mp4"
        },
    }
    pr = _CONN.parse_poll(resp)
    assert pr.status == PollStatus.SUCCEEDED


def test_parse_poll_succeeded_extracts_video_url():
    """SUCCEEDED 时 video_urls 包含 content.video_url。"""
    video_url = "https://cdn.example.com/output.mp4"
    resp = {
        "status": "succeeded",
        "content": {"video_url": video_url},
    }
    pr = _CONN.parse_poll(resp)
    assert video_url in pr.video_urls


def test_parse_poll_succeeded_empty_video_url():
    """SUCCEEDED 但 content.video_url 为 None/空时，video_urls 为空列表。"""
    resp = {"status": "succeeded", "content": {}}
    pr = _CONN.parse_poll(resp)
    assert pr.status == PollStatus.SUCCEEDED
    assert pr.video_urls == []


def test_parse_poll_succeeded_missing_content():
    """SUCCEEDED 但无 content 字段时，video_urls 为空列表，不抛异常。"""
    resp = {"status": "succeeded"}
    pr = _CONN.parse_poll(resp)
    assert pr.status == PollStatus.SUCCEEDED
    assert pr.video_urls == []


# ──────────────────────────────────────────────────────────────
# parse_poll — RUNNING / PENDING states
# ──────────────────────────────────────────────────────────────


def test_parse_poll_running_returns_running():
    """status=running -> PollStatus.RUNNING。"""
    pr = _CONN.parse_poll({"status": "running"})
    assert pr.status == PollStatus.RUNNING


def test_parse_poll_queued_returns_running():
    """status=queued -> PollStatus.RUNNING（排队中视为进行中）。"""
    pr = _CONN.parse_poll({"status": "queued"})
    assert pr.status == PollStatus.RUNNING


# ──────────────────────────────────────────────────────────────
# parse_poll — FAILED states
# ──────────────────────────────────────────────────────────────


def test_parse_poll_failed_returns_failed():
    """status=failed -> PollStatus.FAILED。"""
    resp = {
        "status": "failed",
        "error": {"code": "E001", "message": "model unavailable"},
    }
    pr = _CONN.parse_poll(resp)
    assert pr.status == PollStatus.FAILED


def test_parse_poll_failed_extracts_error_message():
    """FAILED 时 error_message 包含 error.message 内容。"""
    resp = {
        "status": "failed",
        "error": {"message": "quota exceeded"},
    }
    pr = _CONN.parse_poll(resp)
    assert pr.error_message is not None
    assert "quota exceeded" in pr.error_message


def test_parse_poll_expired_returns_failed():
    """status=expired -> PollStatus.FAILED。"""
    pr = _CONN.parse_poll({"status": "expired"})
    assert pr.status == PollStatus.FAILED


def test_parse_poll_cancelled_returns_failed():
    """status=cancelled -> PollStatus.FAILED。"""
    pr = _CONN.parse_poll({"status": "cancelled"})
    assert pr.status == PollStatus.FAILED


# ──────────────────────────────────────────────────────────────
# parse_poll — edge cases
# ──────────────────────────────────────────────────────────────


def test_parse_poll_none_resp_returns_unknown():
    """resp_json 为 None 时返回 UNKNOWN，不抛异常。"""
    pr = _CONN.parse_poll(None)  # type: ignore[arg-type]
    assert pr.status == PollStatus.UNKNOWN


def test_parse_poll_unknown_status_returns_unknown():
    """未知状态字符串返回 UNKNOWN。"""
    pr = _CONN.parse_poll({"status": "some_new_state"})
    assert pr.status == PollStatus.UNKNOWN

"""Unit tests for ViduVideoConnector.

测试覆盖:
  - build_submit: T2V (url 结尾 text2video, Authorization 以 "Token " 开头)
  - build_submit: I2V (url 结尾 img2video, body 含 images=[att.url])
  - parse_submit: 从 resp_json 取 task_id
  - parse_poll:   success -> SUCCEEDED + 取 creations[0].url
  - parse_poll:   processing -> RUNNING
  - parse_poll:   failed -> FAILED

pytest-asyncio project asyncio_mode="auto" -- async test 无需 decorator。
"""

from chayuan.server.modality.router.protocol import Attachment, Capability, GenerateReq
from chayuan.server.modality.router.connectors.video_gen.vidu import ViduVideoConnector
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    PollStatus,
)


# ──────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────


def _req(
    *,
    api_key="test-token-abc",
    api_base="",
    prompt="a cat flying",
    attachments=None,
    params=None,
):
    return GenerateReq(
        capability=Capability.T2V,
        model="vidu2.0",
        platform_name="vidu",
        platform_type="vidu",
        api_base=api_base,
        api_key=api_key,
        prompt=prompt,
        attachments=attachments or [],
        params=params or {},
    )


def _image_att(url="https://example.com/photo.jpg"):
    return Attachment(mime="image/jpeg", url=url)


_conn = ViduVideoConnector()


# ──────────────────────────────────────────────────────────────
# build_submit -- T2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_t2v_url_ends_with_text2video():
    """T2V 提交 URL 必须以 text2video 结尾。"""
    url, headers, body = _conn.build_submit(_req())
    assert url.endswith("text2video"), "expected url ending 'text2video', got %r" % url


def test_build_submit_t2v_authorization_token_prefix():
    """Authorization 头必须以 'Token ' 开头（非 Bearer）。"""
    url, headers, body = _conn.build_submit(_req(api_key="my-secret-token"))
    auth = headers.get("Authorization", "")
    assert auth.startswith("Token "), "expected 'Token ' prefix in Authorization, got %r" % auth
    assert "my-secret-token" in auth


def test_build_submit_t2v_body_has_model_and_prompt():
    """T2V body 必须包含 model 和 prompt。"""
    req = _req(prompt="sunset over mountains")
    url, headers, body = _conn.build_submit(req)
    assert body.get("model") == "vidu2.0"
    assert body.get("prompt") == "sunset over mountains"


def test_build_submit_t2v_no_images_key():
    """T2V body 不应包含 images 字段。"""
    url, headers, body = _conn.build_submit(_req())
    assert "images" not in body, "T2V body should not have 'images', got %r" % body


def test_build_submit_uses_default_base_when_empty():
    """api_base 为空时应使用默认 https://api.vidu.com。"""
    url, headers, body = _conn.build_submit(_req(api_base=""))
    assert url.startswith("https://api.vidu.com"), "expected default base in url, got %r" % url


def test_build_submit_uses_custom_base():
    """api_base 非空时应使用自定义 base，并去除尾斜杠。"""
    url, headers, body = _conn.build_submit(_req(api_base="https://my.vidu.internal/"))
    assert url.startswith("https://my.vidu.internal/"), "expected custom base in url, got %r" % url
    assert "//ent" not in url, "double-slash detected: %r" % url


def test_build_submit_t2v_optional_params_passed():
    """req.params 中的可选字段应透传到 body。"""
    req = _req(params={"duration": 5, "aspect_ratio": "16:9", "resolution": "720p"})
    url, headers, body = _conn.build_submit(req)
    assert body.get("duration") == 5
    assert body.get("aspect_ratio") == "16:9"
    assert body.get("resolution") == "720p"


# ──────────────────────────────────────────────────────────────
# build_submit -- I2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_i2v_url_ends_with_img2video():
    """I2V 提交 URL 必须以 img2video 结尾。"""
    att = _image_att("https://example.com/cat.jpg")
    url, headers, body = _conn.build_submit(_req(attachments=[att]))
    assert url.endswith("img2video"), "expected url ending 'img2video', got %r" % url


def test_build_submit_i2v_authorization_token_prefix():
    """I2V Authorization 头同样必须以 'Token ' 开头。"""
    att = _image_att()
    url, headers, body = _conn.build_submit(_req(attachments=[att]))
    auth = headers.get("Authorization", "")
    assert auth.startswith("Token "), "expected 'Token ' prefix in Authorization, got %r" % auth


def test_build_submit_i2v_body_has_images_list():
    """I2V body 必须含 images 字段且为列表。"""
    att_url = "https://example.com/photo.jpg"
    att = _image_att(att_url)
    url, headers, body = _conn.build_submit(_req(attachments=[att]))
    assert "images" in body, "I2V body missing 'images' key: %r" % body
    assert isinstance(body["images"], list), "images should be a list, got %r" % body["images"]


def test_build_submit_i2v_images_contains_attachment_url():
    """I2V body[images] 必须包含附件的 URL。"""
    att_url = "https://example.com/photo.jpg"
    att = _image_att(att_url)
    url, headers, body = _conn.build_submit(_req(attachments=[att]))
    assert body["images"] == [att_url], "expected images=[%r], got %r" % (att_url, body["images"])


def test_build_submit_i2v_only_first_image_used():
    """有多张图片附件时，只取第一张。"""
    att1 = _image_att("https://example.com/first.jpg")
    att2 = _image_att("https://example.com/second.jpg")
    url, headers, body = _conn.build_submit(_req(attachments=[att1, att2]))
    assert body["images"] == ["https://example.com/first.jpg"], \
        "should only include first image, got %r" % body["images"]


def test_build_submit_non_image_attachment_treated_as_t2v():
    """非 image/* 附件不触发 I2V（走 T2V 路径）。"""
    att = Attachment(mime="application/pdf", url="https://example.com/doc.pdf")
    url, headers, body = _conn.build_submit(_req(attachments=[att]))
    assert url.endswith("text2video"), \
        "non-image attachment should not trigger I2V, url=%r" % url
    assert "images" not in body


# ──────────────────────────────────────────────────────────────
# parse_submit
# ──────────────────────────────────────────────────────────────


def test_parse_submit_extracts_task_id():
    """parse_submit 应从顶层 task_id 字段取值。"""
    resp = {"task_id": "vidu-task-xyz-123", "state": "created"}
    result = _conn.parse_submit(resp)
    assert result == "vidu-task-xyz-123"


def test_parse_submit_returns_empty_when_missing():
    """task_id 字段不存在时返回空字符串（不抛异常）。"""
    result = _conn.parse_submit({})
    assert result == ""


def test_parse_submit_handles_none():
    """resp_json 为 None 时返回空字符串。"""
    result = _conn.parse_submit(None)
    assert result == ""


# ──────────────────────────────────────────────────────────────
# parse_poll -- success -> SUCCEEDED
# ──────────────────────────────────────────────────────────────


def test_parse_poll_success_returns_succeeded():
    """state='success' 应返回 PollStatus.SUCCEEDED。"""
    resp = {
        "state": "success",
        "creations": [{"url": "https://vidu.cdn.com/result.mp4"}],
    }
    pr = _conn.parse_poll(resp)
    assert pr.status == PollStatus.SUCCEEDED


def test_parse_poll_success_extracts_video_url():
    """SUCCEEDED 时 video_urls 应包含 creations[0].url。"""
    video_url = "https://vidu.cdn.com/result.mp4"
    resp = {
        "state": "success",
        "creations": [{"url": video_url, "cover": "https://vidu.cdn.com/cover.jpg"}],
    }
    pr = _conn.parse_poll(resp)
    assert pr.video_urls == [video_url], \
        "expected video_urls=[%r], got %r" % (video_url, pr.video_urls)


def test_parse_poll_success_empty_creations_gives_no_urls():
    """creations 为空列表时，video_urls 应为空（不崩溃）。"""
    resp = {"state": "success", "creations": []}
    pr = _conn.parse_poll(resp)
    assert pr.status == PollStatus.SUCCEEDED
    assert pr.video_urls == []


def test_parse_poll_success_missing_url_in_creation():
    """creations[0] 中无 url 字段时，video_urls 应为空（不崩溃）。"""
    resp = {"state": "success", "creations": [{"cover": "https://x.com/cover.jpg"}]}
    pr = _conn.parse_poll(resp)
    assert pr.status == PollStatus.SUCCEEDED
    assert pr.video_urls == []


# ──────────────────────────────────────────────────────────────
# parse_poll -- running states -> RUNNING
# ──────────────────────────────────────────────────────────────


def test_parse_poll_processing_returns_running():
    """state='processing' 应返回 PollStatus.RUNNING。"""
    pr = _conn.parse_poll({"state": "processing"})
    assert pr.status == PollStatus.RUNNING


def test_parse_poll_queueing_returns_running():
    """state='queueing' 应返回 PollStatus.RUNNING。"""
    pr = _conn.parse_poll({"state": "queueing"})
    assert pr.status == PollStatus.RUNNING


def test_parse_poll_created_returns_running():
    """state='created' 应返回 PollStatus.RUNNING。"""
    pr = _conn.parse_poll({"state": "created"})
    assert pr.status == PollStatus.RUNNING


# ──────────────────────────────────────────────────────────────
# parse_poll -- failed -> FAILED
# ──────────────────────────────────────────────────────────────


def test_parse_poll_failed_returns_failed():
    """state='failed' 应返回 PollStatus.FAILED。"""
    pr = _conn.parse_poll({"state": "failed"})
    assert pr.status == PollStatus.FAILED


def test_parse_poll_failed_with_error_message():
    """FAILED 时应提取 error_message 字段。"""
    pr = _conn.parse_poll({"state": "failed", "error_message": "quota exceeded"})
    assert pr.status == PollStatus.FAILED
    assert pr.error_message == "quota exceeded"


def test_parse_poll_failed_fallback_message():
    """FAILED 且无 error_message 时，error_message 不为 None 也不为空。"""
    pr = _conn.parse_poll({"state": "failed"})
    assert pr.status == PollStatus.FAILED
    assert pr.error_message  # 应有兜底文案


# ──────────────────────────────────────────────────────────────
# parse_poll -- unknown state -> UNKNOWN
# ──────────────────────────────────────────────────────────────


def test_parse_poll_unknown_state_returns_unknown():
    """未知 state 应返回 PollStatus.UNKNOWN。"""
    pr = _conn.parse_poll({"state": "some_future_state"})
    assert pr.status == PollStatus.UNKNOWN


def test_parse_poll_missing_state_returns_unknown():
    """无 state 字段时应返回 PollStatus.UNKNOWN。"""
    pr = _conn.parse_poll({})
    assert pr.status == PollStatus.UNKNOWN


def test_parse_poll_none_returns_unknown():
    """resp_json 为 None 时应返回 PollStatus.UNKNOWN（不崩溃）。"""
    pr = _conn.parse_poll(None)
    assert pr.status == PollStatus.UNKNOWN


# ──────────────────────────────────────────────────────────────
# build_poll
# ──────────────────────────────────────────────────────────────


def test_build_poll_url_contains_task_id():
    """轮询 URL 应包含 task_id。"""
    req = _req()
    url, headers = _conn.build_poll(req, "task-abc-999")
    assert "task-abc-999" in url, "task_id not found in poll url: %r" % url


def test_build_poll_url_contains_creations():
    """轮询 URL 路径应含 'creations'（Vidu Enterprise API 规范）。"""
    req = _req()
    url, headers = _conn.build_poll(req, "tid")
    assert "creations" in url, "'creations' not in poll url: %r" % url


def test_build_poll_headers_have_token_auth():
    """轮询头 Authorization 也必须以 'Token ' 开头。"""
    req = _req(api_key="poll-token-xyz")
    url, headers = _conn.build_poll(req, "tid")
    auth = headers.get("Authorization", "")
    assert auth.startswith("Token "), \
        "poll Authorization should start with 'Token ', got %r" % auth

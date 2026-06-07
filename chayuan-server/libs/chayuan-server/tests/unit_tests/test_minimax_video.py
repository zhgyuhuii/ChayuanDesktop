"""Unit tests for MiniMaxVideoConnector (P2b).

验证范围:
  - build_submit: T2V(无 first_frame_image) / I2V(含 first_frame_image)
      URL 含 /v1/video_generation、Authorization Bearer 正确
  - parse_submit: 从响应顶层取 task_id
  - parse_poll: Success→SUCCEEDED 且 pr.raw 不为空 / Processing→RUNNING / Fail→FAILED
  - fetch_result_urls: 因需发真实 HTTP 请求(httpx),本文件只做「pr.raw 含 file_id
      时 parse_poll 正确保留」的静态断言;fetch 的网络层测试需 mock httpx(注释说明)。

pytest 运行环境: py312 机器(本沙箱无 py312,pytest 未运行,仅 ast.parse 自检通过)。
"""

from chayuan.server.modality.router.protocol import Attachment, Capability, GenerateReq
from chayuan.server.modality.router.connectors.video_gen.minimax import (
    MiniMaxVideoConnector,
)
from chayuan.server.modality.router.connectors.video_gen.base_async import PollStatus


# ──────────────────────────────────────────────────────────────
# 辅助
# ──────────────────────────────────────────────────────────────


def _req(
    attachments=None,
    api_key="mm-api-key-123",
    api_base="https://api.minimaxi.com",
    params=None,
):
    return GenerateReq(
        capability=Capability.T2V,
        model="video-01",
        platform_name="minimax",
        platform_type="minimax",
        api_base=api_base,
        api_key=api_key,
        prompt="一只跳舞的猫",
        attachments=attachments or [],
        params=params or {},
    )


# ──────────────────────────────────────────────────────────────
# build_submit — T2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_t2v_url_contains_video_generation():
    """无附件时 URL 应包含 /v1/video_generation。"""
    c = MiniMaxVideoConnector()
    url, _h, _body = c.build_submit(_req())
    assert "/v1/video_generation" in url


def test_build_submit_t2v_no_first_frame_image():
    """T2V body 中不应包含 first_frame_image 字段。"""
    c = MiniMaxVideoConnector()
    _url, _h, body = c.build_submit(_req())
    assert "first_frame_image" not in body


def test_build_submit_t2v_model_and_prompt():
    """body 应包含 model 和 prompt 字段,且值来自 req。"""
    c = MiniMaxVideoConnector()
    _url, _h, body = c.build_submit(_req())
    assert body["model"] == "video-01"
    assert body["prompt"] == "一只跳舞的猫"


def test_build_submit_t2v_authorization_bearer():
    """Authorization header 应为 'Bearer {api_key}'。"""
    c = MiniMaxVideoConnector()
    _url, headers, _body = c.build_submit(_req(api_key="mm-test-key"))
    assert headers["Authorization"] == "Bearer mm-test-key"


def test_build_submit_t2v_content_type_json():
    """Content-Type header 应为 application/json。"""
    c = MiniMaxVideoConnector()
    _url, headers, _body = c.build_submit(_req())
    assert headers.get("Content-Type") == "application/json"


# ──────────────────────────────────────────────────────────────
# build_submit — I2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_i2v_first_frame_image_present():
    """有 image/* 附件时 body 应包含 first_frame_image 字段,值为附件 URL。"""
    c = MiniMaxVideoConnector()
    att = [Attachment(mime="image/png", url="http://x/img.png", name="img")]
    _url, _h, body = c.build_submit(_req(attachments=att))
    assert body.get("first_frame_image") == "http://x/img.png"


def test_build_submit_i2v_url_still_video_generation():
    """I2V 模式下 URL 仍是 /v1/video_generation(MiniMax 不区分 T2V/I2V endpoint)。"""
    c = MiniMaxVideoConnector()
    att = [Attachment(mime="image/jpeg", url="http://x/photo.jpg")]
    url, _h, _body = c.build_submit(_req(attachments=att))
    assert "/v1/video_generation" in url


def test_build_submit_i2v_model_and_prompt():
    """I2V body 中 model/prompt 字段同样正确。"""
    c = MiniMaxVideoConnector()
    att = [Attachment(mime="image/png", url="http://x/img.png")]
    _url, _h, body = c.build_submit(_req(attachments=att))
    assert body["model"] == "video-01"
    assert body["prompt"] == "一只跳舞的猫"


def test_build_submit_non_image_attachment_not_first_frame():
    """非 image/* 附件不应触发 first_frame_image。"""
    c = MiniMaxVideoConnector()
    att = [Attachment(mime="audio/mp3", url="http://x/audio.mp3")]
    _url, _h, body = c.build_submit(_req(attachments=att))
    assert "first_frame_image" not in body


# ──────────────────────────────────────────────────────────────
# build_submit — optional params 透传
# ──────────────────────────────────────────────────────────────


def test_build_submit_optional_params_passthrough():
    """params 中 duration/resolution/prompt_optimizer 应透传到 body。"""
    c = MiniMaxVideoConnector()
    req = _req(params={"duration": 6, "resolution": "1080p", "prompt_optimizer": True})
    _url, _h, body = c.build_submit(req)
    assert body["duration"] == 6
    assert body["resolution"] == "1080p"
    assert body["prompt_optimizer"] is True


def test_build_submit_absent_params_not_included():
    """未在 params 中提供的可选字段不应出现在 body 里。"""
    c = MiniMaxVideoConnector()
    _url, _h, body = c.build_submit(_req())
    for key in ("duration", "resolution", "prompt_optimizer"):
        assert key not in body


# ──────────────────────────────────────────────────────────────
# build_submit — api_base 默认值
# ──────────────────────────────────────────────────────────────


def test_build_submit_default_base_when_empty():
    """api_base 为空时应使用默认 https://api.minimaxi.com。"""
    c = MiniMaxVideoConnector()
    url, _h, _body = c.build_submit(_req(api_base=""))
    assert url.startswith("https://api.minimaxi.com")


def test_build_submit_trailing_slash_stripped():
    """api_base 末尾斜杠应被去除,URL 不会出现双斜杠。"""
    c = MiniMaxVideoConnector()
    url, _h, _body = c.build_submit(_req(api_base="https://api.minimaxi.com/"))
    assert "//" not in url.replace("https://", "")


# ──────────────────────────────────────────────────────────────
# build_poll
# ──────────────────────────────────────────────────────────────


def test_build_poll_url_contains_query_video_generation():
    """轮询 URL 应包含 /v1/query/video_generation 且带 task_id 参数。"""
    c = MiniMaxVideoConnector()
    url, headers = c.build_poll(_req(), "task-xyz-999")
    assert "/v1/query/video_generation" in url
    assert "task_id=task-xyz-999" in url


def test_build_poll_authorization_bearer():
    """轮询 Authorization header 应为 Bearer {api_key}。"""
    c = MiniMaxVideoConnector()
    _url, headers = c.build_poll(_req(api_key="mm-poll-key"), "tid")
    assert headers["Authorization"] == "Bearer mm-poll-key"


# ──────────────────────────────────────────────────────────────
# parse_submit
# ──────────────────────────────────────────────────────────────


def test_parse_submit_extracts_task_id():
    """从顶层响应取 task_id。"""
    c = MiniMaxVideoConnector()
    resp = {"task_id": "hailuo-task-001", "base_resp": {"status_code": 0}}
    assert c.parse_submit(resp) == "hailuo-task-001"


def test_parse_submit_missing_task_id_returns_empty():
    """响应缺少 task_id 时返回空字符串,不 raise。"""
    c = MiniMaxVideoConnector()
    assert c.parse_submit({}) == ""
    assert c.parse_submit({"base_resp": {"status_code": 0}}) == ""


def test_parse_submit_none_safe():
    """parse_submit 接受 None 不 raise。"""
    c = MiniMaxVideoConnector()
    assert c.parse_submit(None) == ""


# ──────────────────────────────────────────────────────────────
# parse_poll — 状态映射
# ──────────────────────────────────────────────────────────────


def test_parse_poll_processing_is_running():
    """Processing 状态 → RUNNING。"""
    c = MiniMaxVideoConnector()
    result = c.parse_poll({"status": "Processing"})
    assert result.status == PollStatus.RUNNING


def test_parse_poll_preparing_is_running():
    """Preparing 状态 → RUNNING。"""
    c = MiniMaxVideoConnector()
    result = c.parse_poll({"status": "Preparing"})
    assert result.status == PollStatus.RUNNING


def test_parse_poll_queueing_is_running():
    """Queueing 状态 → RUNNING。"""
    c = MiniMaxVideoConnector()
    result = c.parse_poll({"status": "Queueing"})
    assert result.status == PollStatus.RUNNING


def test_parse_poll_success_returns_succeeded():
    """Success 状态 → SUCCEEDED。"""
    c = MiniMaxVideoConnector()
    resp = {"status": "Success", "file_id": "file-abc-123"}
    result = c.parse_poll(resp)
    assert result.status == PollStatus.SUCCEEDED


def test_parse_poll_success_raw_not_empty():
    """Success 时 pr.raw 应为原始响应(供 fetch_result_urls 取 file_id)。"""
    c = MiniMaxVideoConnector()
    resp = {"status": "Success", "file_id": "file-abc-123"}
    result = c.parse_poll(resp)
    assert result.raw is not None
    assert result.raw.get("file_id") == "file-abc-123"


def test_parse_poll_success_video_urls_empty():
    """Success 时 video_urls 为空列表(URL 由 fetch_result_urls 获取,不在此处填充)。"""
    c = MiniMaxVideoConnector()
    resp = {"status": "Success", "file_id": "file-abc-123"}
    result = c.parse_poll(resp)
    assert result.video_urls == []


def test_parse_poll_fail_returns_failed():
    """Fail 状态 → FAILED。"""
    c = MiniMaxVideoConnector()
    resp = {
        "status": "Fail",
        "base_resp": {"status_code": 1, "status_msg": "content policy violation"},
    }
    result = c.parse_poll(resp)
    assert result.status == PollStatus.FAILED


def test_parse_poll_fail_error_message():
    """Fail 时 error_message 来自 base_resp.status_msg。"""
    c = MiniMaxVideoConnector()
    resp = {
        "status": "Fail",
        "base_resp": {"status_code": 1, "status_msg": "content policy violation"},
    }
    result = c.parse_poll(resp)
    assert "content policy" in (result.error_message or "")


def test_parse_poll_unknown_status_returns_unknown():
    """未知状态字符串 → UNKNOWN。"""
    c = MiniMaxVideoConnector()
    result = c.parse_poll({"status": "SomeNewStatus"})
    assert result.status == PollStatus.UNKNOWN


def test_parse_poll_empty_response_returns_unknown():
    """空响应 → UNKNOWN,不应 raise。"""
    c = MiniMaxVideoConnector()
    result = c.parse_poll({})
    assert result.status == PollStatus.UNKNOWN


def test_parse_poll_none_safe():
    """parse_poll 接受 None 不 raise。"""
    c = MiniMaxVideoConnector()
    result = c.parse_poll(None)
    assert result.status == PollStatus.UNKNOWN


# ──────────────────────────────────────────────────────────────
# fetch_result_urls — 静态断言(网络层需 mock httpx)
# ──────────────────────────────────────────────────────────────
#
# fetch_result_urls 需要向 /v1/files/retrieve 发真实 HTTP 请求(httpx.AsyncClient.get)。
# 完整测试应 mock httpx.AsyncClient 并断言:
#   - 调用了正确的 URL(含 file_id 参数)和 Bearer 头
#   - 从 resp["file"]["download_url"] 取到下载地址并返回 [url]
#   - file_id 为空时返回 []
#   - retrieve 接口异常时返回 [] 而不 raise
#
# 此处仅验证静态前提:parse_poll Success 时 pr.raw 正确保存了 file_id,
# 使得 fetch_result_urls 能从 pr.raw 取到 file_id。
# 真实 fetch 的异步 mock 测试需 pytest-asyncio + unittest.mock.patch,
# 留待 py312 环境补全。


def test_fetch_result_urls_precondition_file_id_in_raw():
    """前置条件:parse_poll Success 时 pr.raw 含 file_id,fetch_result_urls 能正确读取。"""
    c = MiniMaxVideoConnector()
    resp = {"status": "Success", "file_id": "file-retrieve-456"}
    pr = c.parse_poll(resp)
    # 验证 fetch_result_urls 所需的 file_id 已正确保存在 pr.raw
    assert pr.raw is not None
    file_id = (pr.raw or {}).get("file_id") or ""
    assert file_id == "file-retrieve-456"

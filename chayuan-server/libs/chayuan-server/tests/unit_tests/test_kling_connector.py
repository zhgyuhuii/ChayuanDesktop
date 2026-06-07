"""Unit tests for KlingVideoConnector (T4).

验证范围:
  - _kling_jwt: 产出可被 jwt.decode(verify_signature=False) 解出 iss==ak 且含 exp
  - build_submit: T2V(url 结尾 text2video, 无 image) vs I2V(url 结尾 image2video,
      body.image=附件url, Authorization Bearer 开头, model_name 正确)
  - parse_poll: processing→RUNNING / succeed(取 videos[0].url)→SUCCEEDED / failed→FAILED

pytest 运行环境: py312 机器（本沙箱无 py312，pytest 未运行，仅 ast.parse 自检通过）。
"""

import jwt

from chayuan.server.modality.router.protocol import Attachment, Capability, GenerateReq
from chayuan.server.modality.router.connectors.video_gen.kling import (
    KlingVideoConnector,
    _kling_jwt,
    _split_keys,
)
from chayuan.server.modality.router.connectors.video_gen.base_async import PollStatus


# ──────────────────────────────────────────────────────────────
# 辅助
# ──────────────────────────────────────────────────────────────


def _req(attachments=None, api_key="AK123:SK456", api_base="https://api.klingai.com"):
    return GenerateReq(
        capability=Capability.T2V,
        model="kling-v2-5-turbo",
        platform_name="kling",
        platform_type="kling",
        api_base=api_base,
        api_key=api_key,
        prompt="跳舞的猫",
        attachments=attachments or [],
    )


# ──────────────────────────────────────────────────────────────
# _kling_jwt
# ──────────────────────────────────────────────────────────────


def test_kling_jwt_carries_ak():
    """JWT token 中 iss 应等于传入的 ak。"""
    tok = _kling_jwt("AK123", "SK456")
    payload = jwt.decode(tok, options={"verify_signature": False})
    assert payload["iss"] == "AK123"
    assert "exp" in payload


def test_kling_jwt_has_nbf():
    """JWT token 应包含 nbf 字段（时钟容差）。"""
    tok = _kling_jwt("AK999", "SKSECRET")
    payload = jwt.decode(tok, options={"verify_signature": False})
    assert "nbf" in payload
    # nbf 应比 exp 早 ~1800s
    assert payload["exp"] > payload["nbf"]


def test_kling_jwt_returns_str():
    """PyJWT 2.x encode() 返回 str（非 bytes）。"""
    tok = _kling_jwt("ak", "sk")
    assert isinstance(tok, str)


# ──────────────────────────────────────────────────────────────
# _split_keys
# ──────────────────────────────────────────────────────────────


def test_split_keys_normal():
    ak, sk = _split_keys("AK123:SK456")
    assert ak == "AK123"
    assert sk == "SK456"


def test_split_keys_colon_in_sk():
    """sk 含冒号时，只按第一个冒号切分。"""
    ak, sk = _split_keys("AK:SK:extra")
    assert ak == "AK"
    assert sk == "SK:extra"


def test_split_keys_no_colon():
    ak, sk = _split_keys("ONLYONE")
    assert ak == "ONLYONE"
    assert sk == ""


# ──────────────────────────────────────────────────────────────
# build_submit — T2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_t2v_url_ends_text2video():
    """无附件时 URL 以 /text2video 结尾。"""
    c = KlingVideoConnector()
    url, headers, body = c.build_submit(_req())
    assert url.endswith("/v1/videos/text2video")


def test_build_submit_t2v_no_image_field():
    """T2V body 中不应有 image 字段。"""
    c = KlingVideoConnector()
    _url, _h, body = c.build_submit(_req())
    assert "image" not in body


def test_build_submit_t2v_model_name():
    """body.model_name 应等于 req.model。"""
    c = KlingVideoConnector()
    _url, _h, body = c.build_submit(_req())
    assert body["model_name"] == "kling-v2-5-turbo"


def test_build_submit_t2v_authorization_bearer():
    """Authorization header 应以 'Bearer ' 开头。"""
    c = KlingVideoConnector()
    _url, headers, _body = c.build_submit(_req())
    assert headers["Authorization"].startswith("Bearer ")


# ──────────────────────────────────────────────────────────────
# build_submit — I2V
# ──────────────────────────────────────────────────────────────


def test_build_submit_i2v_url_ends_image2video():
    """有图片附件时 URL 以 /image2video 结尾。"""
    c = KlingVideoConnector()
    att = [Attachment(mime="image/png", url="http://x/a.png", name="a")]
    url, _h, _body = c.build_submit(_req(attachments=att))
    assert url.endswith("/v1/videos/image2video")


def test_build_submit_i2v_image_field():
    """I2V body 中应有 image 字段，等于附件 URL。"""
    c = KlingVideoConnector()
    att = [Attachment(mime="image/png", url="http://x/a.png", name="a")]
    _url, _h, body = c.build_submit(_req(attachments=att))
    assert body.get("image") == "http://x/a.png"


def test_build_submit_i2v_model_name_correct():
    """I2V body.model_name 同样应等于 req.model。"""
    c = KlingVideoConnector()
    att = [Attachment(mime="image/jpeg", url="http://x/photo.jpg")]
    _url, _h, body = c.build_submit(_req(attachments=att))
    assert body["model_name"] == "kling-v2-5-turbo"


# ──────────────────────────────────────────────────────────────
# build_submit — optional params 透传
# ──────────────────────────────────────────────────────────────


def test_build_submit_optional_params_passthrough():
    """params 中的 duration/aspect_ratio 应透传到 body。"""
    c = KlingVideoConnector()
    req = GenerateReq(
        capability=Capability.T2V,
        model="kling-v2-5-turbo",
        platform_name="kling",
        platform_type="kling",
        api_base="https://api.klingai.com",
        api_key="AK123:SK456",
        prompt="test",
        params={"duration": 5, "aspect_ratio": "16:9"},
    )
    _url, _h, body = c.build_submit(req)
    assert body["duration"] == 5
    assert body["aspect_ratio"] == "16:9"


def test_build_submit_absent_params_not_included():
    """params 中没有的字段不应出现在 body 里。"""
    c = KlingVideoConnector()
    _url, _h, body = c.build_submit(_req())
    for key in ("duration", "aspect_ratio", "mode", "negative_prompt"):
        assert key not in body


# ──────────────────────────────────────────────────────────────
# build_submit — api_base 默认值
# ──────────────────────────────────────────────────────────────


def test_build_submit_default_base_when_empty():
    """api_base 为空时应使用默认 https://api.klingai.com。"""
    c = KlingVideoConnector()
    url, _h, _body = c.build_submit(_req(api_base=""))
    assert url.startswith("https://api.klingai.com")


# ──────────────────────────────────────────────────────────────
# parse_submit
# ──────────────────────────────────────────────────────────────


def test_parse_submit_extracts_task_id():
    c = KlingVideoConnector()
    resp = {"code": 0, "message": "Success", "data": {"task_id": "task-abc-123"}}
    assert c.parse_submit(resp) == "task-abc-123"


def test_parse_submit_missing_data_returns_empty():
    c = KlingVideoConnector()
    assert c.parse_submit({}) == ""
    assert c.parse_submit({"data": {}}) == ""


# ──────────────────────────────────────────────────────────────
# parse_poll — 状态映射
# ──────────────────────────────────────────────────────────────


def test_parse_poll_processing_is_running():
    """processing 状态 → RUNNING。"""
    c = KlingVideoConnector()
    result = c.parse_poll({"data": {"task_status": "processing"}})
    assert result.status == PollStatus.RUNNING


def test_parse_poll_submitted_is_running():
    """submitted 状态 → RUNNING。"""
    c = KlingVideoConnector()
    result = c.parse_poll({"data": {"task_status": "submitted"}})
    assert result.status == PollStatus.RUNNING


def test_parse_poll_pending_is_running():
    """pending 状态 → RUNNING。"""
    c = KlingVideoConnector()
    result = c.parse_poll({"data": {"task_status": "pending"}})
    assert result.status == PollStatus.RUNNING


def test_parse_poll_succeed_returns_succeeded_with_url():
    """succeed 状态 → SUCCEEDED，video_urls 取自 task_result.videos[].url。"""
    c = KlingVideoConnector()
    resp = {
        "data": {
            "task_status": "succeed",
            "task_result": {
                "videos": [{"url": "http://x/v.mp4", "id": "v1"}]
            },
        }
    }
    result = c.parse_poll(resp)
    assert result.status == PollStatus.SUCCEEDED
    assert result.video_urls == ["http://x/v.mp4"]


def test_parse_poll_succeed_multiple_videos_takes_all():
    """succeed 时多个视频 URL 都收集（基类只下载第一个，但全量保留）。"""
    c = KlingVideoConnector()
    resp = {
        "data": {
            "task_status": "succeed",
            "task_result": {
                "videos": [
                    {"url": "http://x/v1.mp4"},
                    {"url": "http://x/v2.mp4"},
                ]
            },
        }
    }
    result = c.parse_poll(resp)
    assert result.status == PollStatus.SUCCEEDED
    assert len(result.video_urls) == 2


def test_parse_poll_failed_returns_failed_with_message():
    """failed 状态 → FAILED，error_message 取自 task_status_msg。"""
    c = KlingVideoConnector()
    resp = {
        "data": {
            "task_status": "failed",
            "task_status_msg": "content policy violation",
        }
    }
    result = c.parse_poll(resp)
    assert result.status == PollStatus.FAILED
    assert "content policy" in (result.error_message or "")


def test_parse_poll_unknown_status_returns_unknown():
    """未知状态字符串 → UNKNOWN。"""
    c = KlingVideoConnector()
    result = c.parse_poll({"data": {"task_status": "something_new"}})
    assert result.status == PollStatus.UNKNOWN


def test_parse_poll_empty_response():
    """空/缺失 data → UNKNOWN（不应 raise）。"""
    c = KlingVideoConnector()
    result = c.parse_poll({})
    assert result.status == PollStatus.UNKNOWN

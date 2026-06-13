"""DashScopeT2VConnector._build_submit_payload 单测:T2V / I2V 分流。

新版 wan2.x:图生视频用 input.media=[{type:first_frame,url}] + parameters.resolution;
老版 wanx2.1:图生视频用 input.img_url + parameters.size。
契约对齐 DashScope 真实 API(2026-06-13 用真实 key 实测确认)。
"""

from chayuan.server.modality.router.protocol import GenerateReq, Capability, Attachment
from chayuan.server.modality.router.connectors.video_gen.dashscope import DashScopeT2VConnector


def _req(attachments, model="wan2.6-i2v", params=None):
    return GenerateReq(
        capability=Capability.T2V,
        model=model,
        platform_name="bailian",
        platform_type="openai",
        api_base="https://dashscope.aliyuncs.com",
        api_key="k",
        prompt="一只猫在跳舞",
        params=params or {},
        attachments=attachments,
    )


def test_t2v_payload_no_image_fields():
    """纯文生视频:input 里既无 media 也无 img_url。"""
    payload = DashScopeT2VConnector()._build_submit_payload(_req([]))
    assert "media" not in payload["input"]
    assert "img_url" not in payload["input"]
    assert payload["input"]["prompt"] == "一只猫在跳舞"


def test_new_wan_i2v_uses_media_first_frame():
    """新版 wan2.x 图生视频:input.media=[{type:first_frame,url}],公网 URL 原样透传。"""
    att = Attachment(mime="image/png", url="https://example.com/a.png", name="a.png")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att]))
    assert payload["input"]["media"] == [{"type": "first_frame", "url": "https://example.com/a.png"}]
    assert "img_url" not in payload["input"]
    assert payload["parameters"]["resolution"] in ("720P", "1080P")


def test_new_wan_i2v_inmemory_bytes_to_data_uri():
    """内存 bytes 附件 -> base64 data URI(DashScope 够不到 localhost)。"""
    att = Attachment(mime="image/png", data=b"\x89PNG\r\n\x1a\n", name="a.png")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att]))
    url = payload["input"]["media"][0]["url"]
    assert url.startswith("data:image/png;base64,")


def test_old_wanx_i2v_uses_img_url():
    """老版 wanx2.1 图生视频:仍用 input.img_url + parameters.size。"""
    att = Attachment(mime="image/jpeg", url="https://example.com/first.jpg", name="first.jpg")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att], model="wanx2.1-i2v-turbo"))
    assert payload["input"].get("img_url") == "https://example.com/first.jpg"
    assert "media" not in payload["input"]
    assert "size" in payload["parameters"]


def test_i2v_skips_non_image_attachments():
    """非图片附件不带图。"""
    att = Attachment(mime="video/mp4", url="https://example.com/b.mp4", name="b.mp4")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att]))
    assert "media" not in payload["input"]
    assert "img_url" not in payload["input"]


def test_i2v_picks_first_image_attachment():
    """多附件取第一个 image/*。"""
    att1 = Attachment(mime="application/pdf", url="https://example.com/doc.pdf", name="doc.pdf")
    att2 = Attachment(mime="image/jpeg", url="https://example.com/first.jpg", name="first.jpg")
    att3 = Attachment(mime="image/png", url="https://example.com/second.png", name="second.png")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att1, att2, att3]))
    assert payload["input"]["media"][0]["url"] == "https://example.com/first.jpg"


def test_old_wan_t2v_parameters_preserved():
    """老版 t2v:model / size / duration / seed 保留。"""
    req = _req([], model="wanx2.1-t2v-turbo", params={"size": "1280*720", "duration": 5, "seed": 42})
    payload = DashScopeT2VConnector()._build_submit_payload(req)
    assert payload["model"] == "wanx2.1-t2v-turbo"
    assert payload["parameters"]["size"] == "1280*720"
    assert payload["parameters"]["duration"] == 5
    assert payload["parameters"]["seed"] == 42


def test_new_wan_i2v_resolution_from_form_param():
    """表单传 resolution=1080p -> 1080P;480p -> 提升 720P。"""
    att = Attachment(mime="image/png", url="https://example.com/a.png")
    p1 = DashScopeT2VConnector()._build_submit_payload(_req([att], params={"resolution": "1080p"}))
    assert p1["parameters"]["resolution"] == "1080P"
    p2 = DashScopeT2VConnector()._build_submit_payload(_req([att], params={"resolution": "480p"}))
    assert p2["parameters"]["resolution"] == "720P"

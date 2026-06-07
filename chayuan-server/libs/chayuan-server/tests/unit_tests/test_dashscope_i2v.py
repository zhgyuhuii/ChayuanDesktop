"""DashScopeT2VConnector._build_submit_payload 单测：T2V / I2V 分流。"""

from chayuan.server.modality.router.protocol import GenerateReq, Capability, Attachment
from chayuan.server.modality.router.connectors.video_gen.dashscope import DashScopeT2VConnector


def _req(attachments):
    return GenerateReq(
        capability=Capability.T2V,
        model="wan2.6-i2v",
        platform_name="bailian",
        platform_type="openai",
        api_base="https://dashscope.aliyuncs.com",
        api_key="k",
        prompt="一只猫在跳舞",
        attachments=attachments,
    )


def test_t2v_payload_has_no_img_url():
    """纯文生视频：input 里不带 img_url。"""
    payload = DashScopeT2VConnector()._build_submit_payload(_req([]))
    assert "img_url" not in payload.get("input", {})
    assert payload["input"]["prompt"] == "一只猫在跳舞"


def test_i2v_payload_includes_img_url():
    """图生视频：input 里带 img_url，取第一个 image/* 附件的 url。"""
    att = Attachment(mime="image/png", url="https://example.com/a.png", name="a.png")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att]))
    assert payload["input"].get("img_url") == "https://example.com/a.png"


def test_i2v_skips_non_image_attachments():
    """非图片附件不影响结果：img_url 仍然缺失。"""
    att = Attachment(mime="video/mp4", url="https://example.com/b.mp4", name="b.mp4")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att]))
    assert "img_url" not in payload.get("input", {})


def test_i2v_picks_first_image_attachment():
    """多个附件时取第一个 image/* 附件。"""
    att1 = Attachment(mime="application/pdf", url="https://example.com/doc.pdf", name="doc.pdf")
    att2 = Attachment(mime="image/jpeg", url="https://example.com/first.jpg", name="first.jpg")
    att3 = Attachment(mime="image/png", url="https://example.com/second.png", name="second.png")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att1, att2, att3]))
    assert payload["input"].get("img_url") == "https://example.com/first.jpg"


def test_payload_model_and_parameters_preserved():
    """model / parameters 字段与 generate() 原有行为一致。"""
    req = GenerateReq(
        capability=Capability.T2V,
        model="wanx2.1-t2v-turbo",
        platform_name="bailian",
        platform_type="openai",
        api_base="https://dashscope.aliyuncs.com",
        api_key="k",
        prompt="test",
        params={"size": "1280*720", "duration": 5, "seed": 42},
        attachments=[],
    )
    payload = DashScopeT2VConnector()._build_submit_payload(req)
    assert payload["model"] == "wanx2.1-t2v-turbo"
    assert payload["parameters"]["size"] == "1280*720"
    assert payload["parameters"]["duration"] == 5
    assert payload["parameters"]["seed"] == 42

"""T5: 验证 kling 厂商已正确注册到 PROVIDER_CATALOG 和 _PROVIDER_DEFAULT_MODELS。"""
from chayuan.server.config_panel.model_config import (
    PROVIDER_CATALOG,
    _PROVIDER_DEFAULT_MODELS,
)


def test_kling_default_video_models():
    kling = _PROVIDER_DEFAULT_MODELS.get("kling")
    assert kling is not None, "kling 不在 _PROVIDER_DEFAULT_MODELS 中"
    assert kling.get("text2video_models"), "kling 缺少 text2video_models"
    assert "kling-v2-5-turbo" in kling["text2video_models"]
    assert "kling-v1-6" in kling["text2video_models"]


def test_kling_in_provider_catalog():
    pids = [p.pid for p in PROVIDER_CATALOG]
    assert "kling" in pids, "kling 不在 PROVIDER_CATALOG 中"

    kling_meta = next(p for p in PROVIDER_CATALOG if p.pid == "kling")
    assert kling_meta.platform_type == "kling"
    assert kling_meta.default_api_base == "https://api.klingai.com"
    # 确认 default_models 已经被 _attach_provider_default_models 写入
    assert kling_meta.default_models.get("text2video_models"), \
        "kling ProviderMeta.default_models 未被 attach"

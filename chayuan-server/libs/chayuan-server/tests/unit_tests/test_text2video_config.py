from chayuan.settings import PlatformConfig
from chayuan.server.api_server.provider_routes import _MODEL_FIELDS


def test_platform_config_has_text2video_field():
    cfg = PlatformConfig(platform_name="p", platform_type="openai", text2video_models=["wan2.7-t2v"])
    assert cfg.text2video_models == ["wan2.7-t2v"]


def test_platform_config_text2video_defaults_empty():
    cfg = PlatformConfig(platform_name="p", platform_type="openai")
    assert cfg.text2video_models == []


def test_model_fields_includes_text2video():
    assert "text2video_models" in _MODEL_FIELDS


def test_bailian_default_has_text2video():
    from chayuan.server.config_panel.model_config import _PROVIDER_DEFAULT_MODELS
    assert _PROVIDER_DEFAULT_MODELS["bailian"].get("text2video_models")

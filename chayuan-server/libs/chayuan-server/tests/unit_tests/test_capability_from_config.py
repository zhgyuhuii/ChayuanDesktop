"""Unit tests for capability_from_config / capability_from_platform_dict.

这两个函数实现"配置优先"路由:模型被配置在某 platform 的 *_models 字段里时,
据字段判断 capability;未命中返回 None,调用方退回前缀推断 classify_capability。

注意:本文件只测试纯逻辑(无 DB、无网络),可在任意 Python 环境运行。
"""
from __future__ import annotations

import pytest

from chayuan.server.modality.router.protocol import Capability
from chayuan.server.modality.router.routing import (
    capability_from_config,
    capability_from_platform_dict,
)


# ---------------------------------------------------------------------------
# capability_from_config — 基于 get_model_info() 返回的 info dict
# ---------------------------------------------------------------------------

class TestCapabilityFromConfig:
    """capability_from_config(model, info) 的行为验证。"""

    def _info(self, model_type: str) -> dict:
        """构造最小 info dict(仅含 model_type 字段,其余字段省略)。"""
        return {
            "platform_name": "test-platform",
            "platform_type": "openai",
            "model_type": model_type,
            "model_name": "dummy",
            "api_base_url": "http://localhost",
            "api_key": "sk-test",
        }

    def test_text2video_returns_t2v(self):
        assert capability_from_config("wan2.1-t2v", self._info("text2video")) is Capability.T2V

    def test_text2image_returns_t2i(self):
        assert capability_from_config("wanx-v1", self._info("text2image")) is Capability.T2I

    def test_image2text_returns_vl(self):
        assert capability_from_config("gpt-4o", self._info("image2text")) is Capability.VL

    def test_rerank_returns_rerank(self):
        assert capability_from_config("bge-reranker-v2", self._info("rerank")) is Capability.RERANK

    def test_embed_returns_embedding(self):
        assert capability_from_config("bge-m3", self._info("embed")) is Capability.EMBEDDING

    def test_speech2text_returns_asr(self):
        assert capability_from_config("whisper-1", self._info("speech2text")) is Capability.ASR

    def test_text2speech_returns_tts(self):
        assert capability_from_config("tts-1", self._info("text2speech")) is Capability.TTS

    def test_llm_returns_chat(self):
        assert capability_from_config("gpt-4o-mini", self._info("llm")) is Capability.CHAT

    # 未命中 / 边界

    def test_unknown_model_type_returns_none(self):
        """model_type 不在映射表里 → None,让调用方退回前缀推断。"""
        assert capability_from_config("some-model", self._info("image2image")) is None

    def test_empty_model_type_returns_none(self):
        assert capability_from_config("some-model", self._info("")) is None

    def test_none_info_returns_none(self):
        assert capability_from_config("some-model", None) is None

    def test_empty_info_dict_returns_none(self):
        assert capability_from_config("some-model", {}) is None

    def test_model_with_namespace_prefix(self):
        """model 参数含 '::' 前缀时,capability 仍由 info['model_type'] 决定。"""
        info = self._info("text2image")
        assert capability_from_config("dashscope::wanx-v1", info) is Capability.T2I


# ---------------------------------------------------------------------------
# capability_from_platform_dict — 基于原始 platform dict(*_models 列表)
# ---------------------------------------------------------------------------

class TestCapabilityFromPlatformDict:
    """capability_from_platform_dict(model, platform) 的行为验证。"""

    _PLATFORM: dict = {
        "platform_name": "test-platform",
        "text2video_models": ["wan2.1-t2v", "wan2.1-i2v", "kling-v1"],
        "text2image_models": ["wanx-v1", "dall-e-3", "flux-schnell"],
        "image2text_models": ["qwen-vl-plus"],
        "rerank_models": ["bge-reranker-v2-m3"],
        "embed_models": ["bge-m3", "text-embedding-v3"],
        "speech2text_models": ["paraformer-v2"],
        "text2speech_models": ["cosyvoice-v2"],
        "llm_models": ["deepseek-chat", "qwen-turbo"],
    }

    def test_text2video_model_returns_t2v(self):
        assert capability_from_platform_dict("wan2.1-t2v", self._PLATFORM) is Capability.T2V

    def test_text2image_model_returns_t2i(self):
        assert capability_from_platform_dict("wanx-v1", self._PLATFORM) is Capability.T2I

    def test_image2text_model_returns_vl(self):
        assert capability_from_platform_dict("qwen-vl-plus", self._PLATFORM) is Capability.VL

    def test_rerank_model_returns_rerank(self):
        assert capability_from_platform_dict("bge-reranker-v2-m3", self._PLATFORM) is Capability.RERANK

    def test_embed_model_returns_embedding(self):
        assert capability_from_platform_dict("bge-m3", self._PLATFORM) is Capability.EMBEDDING

    def test_speech2text_model_returns_asr(self):
        assert capability_from_platform_dict("paraformer-v2", self._PLATFORM) is Capability.ASR

    def test_text2speech_model_returns_tts(self):
        assert capability_from_platform_dict("cosyvoice-v2", self._PLATFORM) is Capability.TTS

    def test_llm_model_returns_chat(self):
        assert capability_from_platform_dict("deepseek-chat", self._PLATFORM) is Capability.CHAT

    def test_not_in_any_list_returns_none(self):
        """模型名不在任何 *_models 列表 → None。"""
        assert capability_from_platform_dict("unknown-model-xyz", self._PLATFORM) is None

    def test_none_platform_returns_none(self):
        assert capability_from_platform_dict("wan2.1-t2v", None) is None

    def test_empty_platform_returns_none(self):
        assert capability_from_platform_dict("wan2.1-t2v", {}) is None

    def test_empty_model_returns_none(self):
        assert capability_from_platform_dict("", self._PLATFORM) is None

    def test_model_with_namespace_prefix_stripped(self):
        """'platform::model' 写法:只取 '::' 后半部分做列表匹配。"""
        assert capability_from_platform_dict("aliyun::wan2.1-t2v", self._PLATFORM) is Capability.T2V

    def test_model_in_second_t2v_slot(self):
        assert capability_from_platform_dict("kling-v1", self._PLATFORM) is Capability.T2V

    def test_model_in_embed_list(self):
        assert capability_from_platform_dict("text-embedding-v3", self._PLATFORM) is Capability.EMBEDDING

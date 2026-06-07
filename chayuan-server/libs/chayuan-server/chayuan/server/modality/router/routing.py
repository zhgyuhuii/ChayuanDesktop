"""能力按配置路由:模型被配进某 platform 的 *_models 列表时,据字段判 capability。

配置优先、前缀兜底:create_modality_completion 先调本函数,返回 None 再退回
classify_capability。

实现说明
--------
get_model_info() 已经把 "text2image_models" / "text2speech_models" 等字段名
split("_")[0] 后以 info["model_type"] 返回(值如 "text2image" / "text2speech" /
"llm" / "embed" / "rerank" / "image2text" / "speech2text")。
因此 capability_from_config 直接读 info["model_type"] 即可得到"配置里该模型属于
哪类"这一结论,等价于遍历 platform 的 *_models 列表,且无需二次 DB 查询。

若调用方已持有原始 platform dict(含 *_models 列表),也可用
capability_from_platform_dict(model, platform_dict) 直接匹配。
"""
from __future__ import annotations

from typing import Dict, Optional

from chayuan.server.modality.router.protocol import Capability

# get_model_info 返回的 model_type 值 → Capability
# model_type 来自 get_config_models 里的 m_type.split("_")[0],
# 其中 m_type 是 *_models 字段名,例:
#   "text2image_models"  → model_type="text2image"  → T2I
#   "text2speech_models" → model_type="text2speech"  → TTS (注: yaml 字段是 text2speech)
#   "speech2text_models" → model_type="speech2text"  → ASR
#   "image2text_models"  → model_type="image2text"   → VL
#   "rerank_models"      → model_type="rerank"        → RERANK
#   "embed_models"       → model_type="embed"         → EMBEDDING
#   "llm_models"         → model_type="llm"           → CHAT
#   "text2video_models"  → model_type="text2video"    → T2V
_MODEL_TYPE_TO_CAP: Dict[str, Capability] = {
    "text2video":   Capability.T2V,
    "text2image":   Capability.T2I,
    "image2text":   Capability.VL,
    "rerank":       Capability.RERANK,
    "embed":        Capability.EMBEDDING,
    "speech2text":  Capability.ASR,
    "text2speech":  Capability.TTS,
    "llm":          Capability.CHAT,
}

# *_models 字段名 → Capability(供 capability_from_platform_dict 使用)
_FIELD_TO_CAP: Dict[str, Capability] = {
    "text2video_models":  Capability.T2V,
    "text2image_models":  Capability.T2I,
    "image2text_models":  Capability.VL,
    "rerank_models":      Capability.RERANK,
    "embed_models":       Capability.EMBEDDING,
    "speech2text_models": Capability.ASR,
    "text2speech_models": Capability.TTS,
    "llm_models":         Capability.CHAT,
}


def capability_from_config(model: str, info: Optional[Dict]) -> Optional[Capability]:
    """从 get_model_info() 返回的 info dict 推断 Capability。

    Args:
        model: 模型名(含或不含 platform:: 前缀均可,函数内自动剥离)。
               实际匹配用 info["model_type"],model 参数保留供日志/调试用。
        info:  get_model_info() 的返回值。None 或空 dict 时返回 None。

    Returns:
        命中配置时返回对应 Capability,未命中返回 None(调用方应回退到
        classify_capability)。
    """
    if not info:
        return None
    model_type = info.get("model_type") or ""
    return _MODEL_TYPE_TO_CAP.get(model_type)


def capability_from_platform_dict(model: str, platform: Optional[Dict]) -> Optional[Capability]:
    """从原始 platform dict(含 *_models 列表)推断 Capability。

    适用于调用方已持有完整 platform 配置(如 get_config_platforms() 的返回值)
    的场景。优先级与 capability_from_config 相同:命中即返,未命中返 None。

    Args:
        model:    模型名。若含 "::" 命名空间前缀,自动取 "::" 后半部分匹配。
        platform: platform dict,应含 text2video_models / text2image_models 等字段。
    """
    if not model or not platform:
        return None
    name = model.split("::", 1)[1] if "::" in model else model
    for field, cap in _FIELD_TO_CAP.items():
        vals = platform.get(field)
        if isinstance(vals, list) and name in vals:
            return cap
    return None

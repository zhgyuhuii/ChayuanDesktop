"""Hub 模型目录归一适配器包。

把 HuggingFace / ModelScope 的搜索 + 文件清单接口归一到统一契约
（:class:`NormalizedModelCard` / :class:`HubFile` / :class:`SearchPage`），
供「模型广场」上层路由 / UI 消费。

子模块：
* ``base`` —— 契约 + :class:`HubAdapter` 抽象基类。
* ``capability`` —— capability / 参数量 / 可跑格式 纯函数（复用 identifier 映射）。
* ``huggingface`` —— :class:`HuggingFaceAdapter`。
* ``modelscope`` —— :class:`ModelScopeAdapter`。
"""
from __future__ import annotations

from typing import Optional

from chayuan.server.model_registry.hub_catalog.base import (
    HubAdapter,
    HubFile,
    NormalizedModelCard,
    SearchPage,
)
from chayuan.server.model_registry.hub_catalog.capability import (
    capability_from_hf_pipeline,
    capability_from_ms_tasks,
    is_runnable_format,
    parse_param_size,
)

# 可服务 capability 集合：capability 不在此集合内（如 text-to-image / text-to-video）
# 的模型 serveable=False（能搜到、能看，但本机服务栈暂不直接挂载）。
_SERVEABLE_CAPS = {
    "chat",
    "text-embedding",
    "rerank",
    "speech-to-text",
    "text-to-audio",
    "image-embedding",
    "image-to-text",
}


def is_serveable(capability: Optional[str]) -> bool:
    """capability 是否在可服务集合内。"""
    return bool(capability) and capability in _SERVEABLE_CAPS


__all__ = [
    "HubAdapter",
    "HubFile",
    "NormalizedModelCard",
    "SearchPage",
    "capability_from_hf_pipeline",
    "capability_from_ms_tasks",
    "is_runnable_format",
    "parse_param_size",
    "is_serveable",
    "_SERVEABLE_CAPS",
]

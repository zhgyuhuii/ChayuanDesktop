"""Hub 搜索结果的 capability / 元数据归一（纯函数，无文件 I/O、无网络）。

capability 取值与 :mod:`chayuan.server.model_registry.identifier` 对齐，
映射常量**直接复用** identifier，禁止重抄一份，避免两处漂移。

公开 API：
* :func:`capability_from_hf_pipeline`
* :func:`capability_from_ms_tasks`
* :func:`parse_param_size`
* :func:`is_runnable_format`
"""
from __future__ import annotations

import re
from typing import Any, List, Optional, Sequence

from chayuan.server.model_registry import identifier as _ident

# identifier._CAPABILITY_BY_PIPELINE 已含 "image-text-to-text" -> "image-to-text"
# （见 identifier.py），因此**无需**本地补充 dict。如果上游删了该 key，下面这
# 个兜底 dict 会补回缺失项；正常情况下它是空的，纯属防御。
_HF_PIPELINE_SUPPLEMENT = {
    # 只补 identifier._CAPABILITY_BY_PIPELINE 里**确实缺失**的 pipeline_tag。
    # 当前为空：identifier 已覆盖 image-text-to-text 等。
}

# 可跑格式：llama-server 吃 gguf，sherpa/onnxruntime 吃 onnx。safetensors 不直接跑。
_RUNNABLE_EXTS = {".gguf", ".onnx"}

# "7B" / "0.5B" / "1.5b"：前面不能紧跟数字或点（避免把版本号 "2.5" 的 5 当参数），
# 后面不能紧跟字母（避免 "Base" 之类）。
_PARAM_RE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])")


def capability_from_hf_pipeline(pipeline_tag: Optional[str]) -> str:
    """HuggingFace ``pipeline_tag`` -> capability。

    None / 未知 -> ``"other"``。
    """
    if not pipeline_tag:
        return "other"
    cap = _ident._CAPABILITY_BY_PIPELINE.get(pipeline_tag)
    if cap is None:
        cap = _HF_PIPELINE_SUPPLEMENT.get(pipeline_tag)
    return cap or "other"


def capability_from_ms_tasks(tasks: Optional[List[Any]]) -> str:
    """ModelScope ``Tasks`` -> capability。

    ``tasks`` 可能为 ``None`` 或 ``[]``（守卫 ``tasks or []``）。
    逐个 task 用同一套 ``_CAPABILITY_BY_PIPELINE`` 映射 ``t["Name"]``；
    映射不中再回退 ``_PATH_HINTS``（按 task name 关键字）；都不中返回 ``"other"``。
    """
    for t in (tasks or []):
        if not isinstance(t, dict):
            continue
        name = t.get("Name")
        if not name:
            continue
        cap = _ident._CAPABILITY_BY_PIPELINE.get(name)
        if cap is None:
            cap = _HF_PIPELINE_SUPPLEMENT.get(name)
        if cap:
            return cap
        # 回退：task name 关键字匹配 _PATH_HINTS
        lowered = str(name).lower()
        for hint, hint_cap in _ident._PATH_HINTS:
            if hint in lowered:
                return hint_cap
    return "other"


def parse_param_size(model_id: Optional[str]) -> Optional[str]:
    """从 model_id / 名称里抠参数量，如 ``"Qwen3-4B-GGUF"`` -> ``"4B"``。

    无法识别返回 ``None``。返回值统一大写 ``B`` 后缀。
    """
    if not model_id:
        return None
    m = _PARAM_RE.search(model_id)
    if not m:
        return None
    return f"{m.group(1)}B"


def parse_param_size_from_tags(tags: Optional[Sequence[Any]]) -> Optional[str]:
    """从 tags 列表里抠参数量,如 HF 仓库标签常含 ``"7B"`` / ``"13b"``。

    作为 :func:`parse_param_size`(从 model_id 抠)的兜底:model_id 里抠不到
    时,逐个 tag 用同一套 ``_PARAM_RE`` 匹配,命中第一个就返回。
    无法识别返回 ``None``。返回值统一大写 ``B`` 后缀。
    """
    for t in (tags or []):
        if not isinstance(t, str):
            continue
        m = _PARAM_RE.search(t)
        if m:
            return f"{m.group(1)}B"
    return None


def is_runnable_format(exts: List[str]) -> bool:
    """给定一组扩展名（含点，如 ``".gguf"``），命中 gguf/onnx 即可跑。"""
    for e in (exts or []):
        if e and e.lower() in _RUNNABLE_EXTS:
            return True
    return False


__all__ = [
    "capability_from_hf_pipeline",
    "capability_from_ms_tasks",
    "parse_param_size",
    "parse_param_size_from_tags",
    "is_runnable_format",
]

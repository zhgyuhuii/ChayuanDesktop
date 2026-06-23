"""模型名 -> PlatformConfig 各 ``*_models`` 桶 的启发式分类。

为什么单独成模块:OpenAI 兼容 ``/models`` 和 Ollama ``/api/tags`` 都不给可靠的模型
类型字段,只能按名字猜。本模块**纯 stdlib**(不 import openai/requests),便于单测与复用。

顺序敏感(更具体的类别在前):
  - ``rerank`` 必须先于 ``embed``(``bge-reranker`` 同时含 ``bge``);
  - ``ocr`` / ``image-edit`` 先于 ``text2image``(``...-image-edit`` / ``...-image`` 都含 image)。
命中第一条规则即归类,都不命中归 ``llm_models``。猜错不致命:前端「移到其他类型」可手动改正。
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple

# (bucket, keywords) —— 顺序敏感,匹配第一条命中的规则
_MODEL_NAME_RULES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("rerank_models",      ("rerank", "reranker", "re-rank", "cross-encoder")),
    ("embed_models",       ("embedding", "bge", "m3e", "gte-", "e5-", "nomic-embed",
                            "mxbai-embed", "jina-embed", "tao-8k", "text-embedding", "embed")),
    ("image2text_models",  ("ocr", "pp-structure")),
    ("image2image_models", ("image-edit", "img2img", "image2image", "inpaint")),
    ("text2image_models",  ("flux", "stable-diffusion", "sdxl", "sd3", "kolors", "wanx",
                            "hunyuan-image", "majic", "text2image", "dall-e",
                            "ernie-image", "qwen-image", "-image")),
    ("text2speech_models", ("cosyvoice", "text2speech", "fish-speech", "fishspeech",
                            "sambert", "chattts", "-tts", "tts-")),
    ("speech2text_models", ("whisper", "sense-voice", "sensevoice", "paraformer",
                            "speech2text", "-asr", "asr-")),
)


def classify_model_ids_by_name(ids: Iterable[Optional[str]]) -> Dict[str, List[str]]:
    """把一串模型 id 按名字启发式分到 PlatformConfig 的各 ``*_models`` 桶。

    返回的 dict 一定含 ``llm_models`` / ``embed_models`` / ``rerank_models``
    (对齐 PlatformConfig 必有字段),其余桶按需出现。空白 / None id 跳过。
    """
    out: Dict[str, List[str]] = {"llm_models": [], "embed_models": [], "rerank_models": []}
    for raw in ids or []:
        name = (raw or "").strip()
        if not name:
            continue
        low = name.lower()
        for bucket, kws in _MODEL_NAME_RULES:
            if any(kw in low for kw in kws):
                out.setdefault(bucket, []).append(name)
                break
        else:
            out["llm_models"].append(name)
    return out

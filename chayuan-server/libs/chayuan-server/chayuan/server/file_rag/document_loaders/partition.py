from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List


_CJK_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")


@dataclass
class _PlainTextElement:
    text: str

    def __str__(self) -> str:
        return self.text

    def to_dict(self) -> Dict[str, Any]:
        return {"type": "Text", "text": self.text, "metadata": {}}


def _plain_text_elements(text: str) -> List:
    parts = [p.strip() for p in re.split(r"\n{2,}", text or "") if p.strip()]
    if not parts and (text or "").strip():
        parts = [(text or "").strip()]
    if not parts:
        return []
    try:
        from unstructured.documents.elements import Text
        return [Text(p) for p in parts]
    except Exception:
        return [_PlainTextElement(p) for p in parts]


def partition_ocr_text(text: str, unstructured_kwargs: Dict[str, Any]) -> List:
    """Partition OCR text without requiring NLTK's English POS tagger for CJK docs."""
    from unstructured.partition.text import partition_text

    kwargs = dict(unstructured_kwargs)
    if "languages" not in kwargs and "language" not in kwargs and _CJK_RE.search(text or ""):
        kwargs["languages"] = ["zho"]

    try:
        return partition_text(text=text, **kwargs)
    except LookupError as exc:
        if "averaged_perceptron_tagger" not in str(exc):
            raise
        return _plain_text_elements(text)

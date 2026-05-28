"""附件 → 纯文本 dispatcher。chat handler 调用,把抽出文字 append 到 LLM prompt。

支持 mime:
  image/*            rapidocr_onnxruntime(已 deps)
  application/pdf    PyMuPDF/fitz(已 deps)
  text/*             直接 decode UTF-8
  audio/*            modality.audio.transcribe(走 whisper sidecar)
  video/*            抽第一帧 OCR + 前 30s 音频 transcribe
  application/msword / docx / openxml  → python-docx 或 unstructured(已 deps)

不支持的 mime → 返 None,handler 忽略该附件。所有抽取容错,任一附件失败
都不阻塞其它附件。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("chayuan.video_generation.attachment_extractor")

# 单附件抽出文本上限 — 防爆 LLM token
_MAX_CHARS_PER_ATTACHMENT = 10_000


def extract_text(path: str, mime: str = "") -> Optional[str]:
    """主入口。失败/不支持返 None。"""
    if not path or not Path(path).is_file():
        return None
    m = (mime or "").lower()
    try:
        if m.startswith("image/"):
            return _extract_image(path)
        if "pdf" in m or path.lower().endswith(".pdf"):
            return _extract_pdf(path)
        if m.startswith("text/") or path.lower().endswith((".txt", ".md")):
            return _extract_text(path)
        if m.startswith("audio/"):
            return _extract_audio(path)
        if "wordprocessingml" in m or path.lower().endswith((".docx", ".doc")):
            return _extract_docx(path)
        # 默认尝试当文本读
        return _extract_text(path)
    except Exception as e:  # noqa: BLE001
        logger.warning("[ext] %s 抽取失败 mime=%s: %r", path, mime, e)
        return None


def _truncate(text: str) -> str:
    if not text:
        return ""
    if len(text) > _MAX_CHARS_PER_ATTACHMENT:
        return text[: _MAX_CHARS_PER_ATTACHMENT] + "\n...(已截)"
    return text


# R1.2 task 会在这里追加 _extract_image / _extract_pdf / _extract_text /
# _extract_audio / _extract_docx 五个子函数。本 task 骨架不实现它们,
# 调用时会因 NameError 抛 → extract_text 的 try/except 兜底返 None。

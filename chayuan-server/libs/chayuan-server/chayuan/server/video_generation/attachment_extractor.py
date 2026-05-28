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


def _extract_image(path: str) -> Optional[str]:
    """rapidocr_onnxruntime 抽文字。"""
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as e:  # noqa: BLE001
        logger.debug("[ext:image] rapidocr 未装,跳过: %r", e)
        return None
    ocr = RapidOCR()
    result, _ = ocr(path)
    if not result:
        return ""
    # result 是 [[box, text, score], ...]
    lines = [r[1] for r in result if r and len(r) >= 2 and r[1]]
    return _truncate("\n".join(lines))


def _extract_pdf(path: str) -> Optional[str]:
    """PyMuPDF 逐页 get_text。"""
    try:
        import fitz  # type: ignore[import-not-found]
    except Exception as e:  # noqa: BLE001
        logger.debug("[ext:pdf] PyMuPDF 未装,跳过: %r", e)
        return None
    parts: list[str] = []
    doc = fitz.open(path)
    try:
        for page in doc:
            parts.append(page.get_text())
    finally:
        doc.close()
    return _truncate("\n".join(p.strip() for p in parts if p.strip()))


def _extract_text(path: str) -> Optional[str]:
    """UTF-8 / GBK / utf-8-sig fallback。"""
    for enc in ("utf-8", "gbk", "utf-8-sig"):
        try:
            with open(path, "r", encoding=enc) as f:
                return _truncate(f.read())
        except UnicodeDecodeError:
            continue
        except Exception as e:  # noqa: BLE001
            logger.debug("[ext:text] %s: %r", path, e)
            return None
    return None


def _extract_audio(path: str) -> Optional[str]:
    """复用 modality.audio.transcribe → whisper sidecar。"""
    try:
        from chayuan.server.modality.audio import AudioPipeline
    except Exception as e:  # noqa: BLE001
        # CLAUDE.md feedback_no_silent_import_debug: 关键 loader import 失败
        # 不能 debug 静默吞,必须 warning+exc_info — 否则 frozen/dev 都
        # 看不到根因(本次 502 就是这种 silent import 浪费排查时间)
        logger.warning("[ext:audio] AudioPipeline import 失败: %r", e, exc_info=True)
        return None
    am = AudioPipeline()
    text = am.transcribe(path)
    return _truncate(text or "")


def _extract_docx(path: str) -> Optional[str]:
    """python-docx → 段落文本拼接;fallback unstructured。"""
    try:
        import docx  # type: ignore[import-not-found]
    except Exception:
        # fallback unstructured(已 deps)
        try:
            from unstructured.partition.auto import partition  # type: ignore
            els = partition(filename=path)
            return _truncate("\n".join(str(e) for e in els))
        except Exception as e:  # noqa: BLE001
            logger.debug("[ext:docx] 全 fallback 失败: %r", e)
            return None
    d = docx.Document(path)
    return _truncate("\n".join(p.text for p in d.paragraphs if p.text.strip()))

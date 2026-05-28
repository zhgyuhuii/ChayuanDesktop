"""Video Generation 模式 — chat 输入 → 流式脚本 → metadata 字段挂载视频组件。

历史:
- N6.c 同步 dict 占位
- R1.3 加附件抽文字 + 高级参数 + sentinel
- 后续(本 commit)真流式 — generate_override_stream 用 llm.astream 逐 chunk
  yield,前端 SSE 累积器逐字符渲染。runner 5a 优先调流式接口。

注:不在 handler 里 submit_task — 用户点"去生成"才真提交。这里只产生脚本。
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Dict, Optional, Tuple

from chayuan.server.chat.handlers.base import BaseModeHandler, register_handler

logger = logging.getLogger("chayuan.chat.handlers.video_generation")


_SCRIPT_PROMPT = """\
# Role:视频文案撰写专家

## Goal:
根据主题(及可选附件参考资料)创作一段适合配音朗读的短视频文案。

## Requirements:
- 只输出纯文案文本,不要前言后语,不要 markdown 围栏
- 段落数:{paragraph_number}
- 语言:{language}(空表示按主题自动判断)
- 适合 30-90 秒朗读时长
- 不出现 "本视频" "接下来我们看看" 这类口播套话

## Video Subject:
{subject}

{attachments_block}
"""


def _build_sentinel(vg_meta: Dict[str, Any]) -> str:
    """构造 [[VG_META]]...[[/VG_META]] 标记 — 前端 parseAndStripVgMeta 抽出
    videoMeta 默认值;TTS / BGM / videoAspect 可被前端后续 patchParams 覆盖。
    """
    payload = {
        "videoMeta": {
            "renderState": "idle",
            "tts": {
                "provider": "piper", "voice": "",
                "rate": 1.0, "volume": 1.0,
            },
            "bgm": {"type": "random", "file": "", "volume": 0.2},
            "videoAspect": vg_meta.get("aspect") or "9:16",
        },
    }
    return "\n\n[[VG_META]]" + json.dumps(payload, ensure_ascii=False) + "[[/VG_META]]"


def _prepare(state: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """从 state 抽 prompt / model / sentinel,失败返 (None, None, error_msg)。

    成功: (prompt, model, sentinel)
    失败: (None, None, "[vg] 错误说明")
    """
    req = state.get("request")
    if req is None:
        return None, None, "[vg] 缺 request 上下文"
    subject = (getattr(req, "query", "") or "").strip()
    if not subject:
        return None, None, "请提供视频主题"

    # 附件抽文字
    attachment_texts: list[str] = []
    attachments = list(getattr(req, "attachments", None) or [])
    if attachments:
        try:
            from chayuan.server.video_generation.attachment_extractor import extract_text
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[vg.gen] attachment_extractor import 失败: %r", e, exc_info=True,
            )
            extract_text = None  # type: ignore[assignment]
        if extract_text is not None:
            for a in attachments:
                path = getattr(a, "path", "") or (
                    a.get("path") if isinstance(a, dict) else ""
                )
                mime = getattr(a, "mime", "") or (
                    a.get("mime", "") if isinstance(a, dict) else ""
                )
                if not path:
                    continue
                text = extract_text(path, mime)
                if text:
                    attachment_texts.append(
                        f"### 附件:{path.rsplit('/', 1)[-1]}\n{text}"
                    )

    attachments_block = (
        "## 附件参考资料(用户上传,请整合到文案中):\n\n"
        + "\n\n".join(attachment_texts)
        if attachment_texts else ""
    )

    # 高级参数 from request.metadata.videoGeneration
    meta = getattr(req, "metadata", None) or {}
    if not isinstance(meta, dict):
        meta = {}
    vg_meta = meta.get("videoGeneration") or {}
    if not isinstance(vg_meta, dict):
        vg_meta = {}
    language = vg_meta.get("language", "") or "auto"
    try:
        paragraph_number = max(1, min(10, int(vg_meta.get("paragraphNumber") or 1)))
    except (TypeError, ValueError):
        paragraph_number = 1

    prompt = _SCRIPT_PROMPT.format(
        subject=subject,
        attachments_block=attachments_block,
        language=language,
        paragraph_number=paragraph_number,
    )

    # 模型选择
    try:
        from chayuan.server.utils import get_default_llm
    except Exception as e:  # noqa: BLE001
        return None, None, f"[vg] LLM gateway import 失败: {e}"
    model = vg_meta.get("model") or get_default_llm()
    if not model:
        return None, None, "[vg] 没拿到可用 chat 模型 — 请到模型广场配 chat capability default"

    return prompt, model, _build_sentinel(vg_meta)


class VideoGenerationHandler(BaseModeHandler):
    mode = "video_generation"
    needs_retrieval = False

    def generate_override_stream(
        self, state: Dict[str, Any],
    ) -> Optional[AsyncIterator[str]]:
        """runner 5a 优先调 — 返 async iterator,逐 chunk emit token SSE。"""
        return self._stream_chunks(state)

    async def _stream_chunks(self, state: Dict[str, Any]) -> AsyncIterator[str]:
        prompt, model, info = _prepare(state)
        if prompt is None:
            # info 是错误消息(_prepare 失败)— 一次性 yield + sentinel 避免前端空白
            yield info or "[vg] 准备失败"
            yield _build_sentinel({})
            return
        sentinel = info  # 成功时 info 是 sentinel
        try:
            from chayuan.server.utils import get_ChatOpenAI
            llm = get_ChatOpenAI(
                model_name=model, temperature=0.7, streaming=True,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg.gen.stream] LLM 实例化失败 model=%s: %r", model, e, exc_info=True)
            yield f"脚本生成失败:{type(e).__name__}: {e}"
            yield sentinel or _build_sentinel({})
            return

        try:
            async for chunk in llm.astream(prompt):
                text = getattr(chunk, "content", None)
                if text:
                    yield str(text)
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg.gen.stream] astream 失败 model=%s: %r", model, e, exc_info=True)
            yield f"\n\n[脚本生成中断:{type(e).__name__}: {e}]"
        yield sentinel or _build_sentinel({})

    async def generate_override(
        self, state: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """非流式回退 — runner 流式失败时走这里。委托 stream 实现累积所有 chunks。"""
        parts: list[str] = []
        async for chunk in self._stream_chunks(state):
            parts.append(chunk)
        return {"answer": "".join(parts)}


register_handler(VideoGenerationHandler())

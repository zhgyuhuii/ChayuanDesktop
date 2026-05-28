"""Video Generation 模式 — chat 输入 → 流式脚本 → metadata 字段挂载视频组件。

R1.3 升级:
- generate_override 从同步 dict(N6.c)升级到读附件文字 + 高级参数
- 解析 state["request"].attachments,调 attachment_extractor 抽文字 append prompt
- 末尾 emit [[VG_META]] sentinel,前端 R2.3 解析写 message.metadata.videoMeta

注:不在 handler 里 submit_task — 用户点"去生成"才真提交。这里只产生脚本。
R5 阶段可改成真流式 yield(需要看 chat runner 协议),当前保持同步 LLM 调用。
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

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


class VideoGenerationHandler(BaseModeHandler):
    mode = "video_generation"
    needs_retrieval = False

    async def generate_override(
        self, state: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """生成视频脚本。
        - 抽 state["request"].query 当主题
        - 读 state["request"].attachments 走 attachment_extractor 抽文字
        - 高级参数(语言/段落/模型/画幅)从 state["request"].metadata.videoGeneration 读
        - 返 {answer: 脚本 + [[VG_META]] sentinel}
        """
        req = state.get("request")
        if req is None:
            return {"answer": "[vg] 缺 request 上下文"}
        subject = (getattr(req, "query", "") or "").strip()
        if not subject:
            return {"answer": "请提供视频主题"}

        # 1. 附件抽文字
        attachment_texts: list[str] = []
        attachments = list(getattr(req, "attachments", None) or [])
        if attachments:
            try:
                from chayuan.server.video_generation.attachment_extractor import extract_text
            except Exception as e:  # noqa: BLE001
                logger.debug("[vg.gen] attachment_extractor import 失败: %r", e)
                extract_text = None  # type: ignore[assignment]
            if extract_text is not None:
                for a in attachments:
                    # a 期望含 path + mime(后端附件对象 或 dict 都兼容)
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

        # 2. 组 prompt
        attachments_block = (
            "## 附件参考资料(用户上传,请整合到文案中):\n\n"
            + "\n\n".join(attachment_texts)
            if attachment_texts else ""
        )
        # 高级参数:从 state.request.metadata.videoGeneration 拿(R3 前端注入)
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

        # 3. 调 LLM 一次拿完整脚本(R5 改流式)
        try:
            from chayuan.server.utils import get_ChatOpenAI, get_default_llm
        except Exception as e:  # noqa: BLE001
            return {"answer": f"[vg] LLM gateway import 失败: {e}"}
        model = vg_meta.get("model") or get_default_llm()
        if not model:
            return {"answer": "[vg] 没拿到可用 chat 模型 — 请到模型广场配 chat capability default"}
        try:
            llm = get_ChatOpenAI(
                model_name=model, temperature=0.7, streaming=False,
            )
            msg = llm.invoke(prompt)
            script = str(getattr(msg, "content", msg)).strip()
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg.gen] LLM 调用失败 model=%s: %r", model, e)
            return {"answer": f"脚本生成失败:{type(e).__name__}: {e}"}

        # 4. 在 answer 末尾附 metadata sentinel,前端 ConversationView 解析(R2.3)
        sentinel = (
            "\n\n[[VG_META]]"
            + json.dumps({
                "videoMeta": {
                    "renderState": "idle",
                    "tts": {
                        "provider": "piper", "voice": "",
                        "rate": 1.0, "volume": 1.0,
                    },
                    "bgm": {"type": "random", "file": "", "volume": 0.2},
                    "videoAspect": vg_meta.get("aspect") or "9:16",
                },
            }, ensure_ascii=False)
            + "[[/VG_META]]"
        )
        return {"answer": script + sentinel}


register_handler(VideoGenerationHandler())

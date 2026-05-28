"""LLM 脚本 + 关键词生成 — 走本项目统一 LLM 网关。

替换上游 chayuan-video-generation/app/services/llm.py 中的 14 家 SDK
分支(openai/moonshot/qwen/dashscope/gemini/azure/ollama/oneapi/g4f/
litellm/cloudflare/minimax/ernie/modelscope),全部统一到本项目已有的
``chayuan.server.utils.get_ChatOpenAI / get_default_llm``。

用户在 Wizard step 2 选模型 → 前端发 model_id;service 层透传到这里。
模型不传 → 走 capability_router("chat") 拿默认 chat 模型(跟
ChatComposer 共享 capability_defaults,无须额外配置)。
"""

from __future__ import annotations

import json
import logging
import re
from typing import List, Optional

logger = logging.getLogger("chayuan.video_generation.script")


# ─────────────────────────────────────────────────────────────────────
# Prompt 模板 — 跟上游一致,仅做轻微简化
# ─────────────────────────────────────────────────────────────────────


_SCRIPT_PROMPT = """\
# Role: 视频文案撰写专家

## Goal:
根据主题(video subject)创作一段适合配音朗读的短视频文案。

## Requirements:
- 只输出纯文案文本,不要前言后语,不要 markdown,不要加引号
- 总段落数: {paragraph_number} 段
- 语言: {language}(空表示按主题自动判断)
- 适合 30-90 秒朗读时长
- 用平实表达,避免太多书面语
- 不出现 "本视频" "接下来我们看看" 这类口播套话

## Video Subject:
{video_subject}
"""

_TERMS_PROMPT = """\
# Role: 视频素材关键词提取

## Goal:
根据视频文案,生成 {amount} 个适合在素材库(Pexels/Pixabay)搜索的英文
关键词。

## Requirements:
- 严格输出 JSON 数组,无多余文本
- 每个关键词 1-2 个单词,英文,小写
- 关键词要具体可视化(避免抽象词如 "feeling" "concept")
- 示例输出: ["spring flower", "blue sky", "running water"]

## Video Subject:
{video_subject}

## Video Script:
{video_script}
"""


# ─────────────────────────────────────────────────────────────────────
# LLM 调用 — 走本项目 ChatOpenAI 统一入口
# ─────────────────────────────────────────────────────────────────────


def _invoke_llm(prompt: str, *, model: Optional[str] = None) -> str:
    """走 chayuan.server.utils.get_ChatOpenAI 拿模型并调用。

    model 不传 → capability_router 解析 chat 默认 → 兜底 get_default_llm。
    """

    try:
        from chayuan.server.utils import get_ChatOpenAI, get_default_llm
    except Exception as e:  # noqa: BLE001
        logger.error("[script] get_ChatOpenAI import 失败: %r", e)
        return ""

    if not model:
        try:
            from chayuan.server.capability_router import resolve_model
            model = resolve_model("chat") or get_default_llm()
        except Exception:  # noqa: BLE001
            model = get_default_llm()

    if not model:
        logger.error("[script] 没拿到可用 chat 模型 — 配模型广场或检查 capability_defaults")
        return ""

    try:
        llm = get_ChatOpenAI(model_name=model, temperature=0.7, streaming=False)
        # langchain 1.x BaseChatModel.invoke;不走流式,wizard step 2
        # 的流式由 API 路由层(M2)单独写 SSE 端点。
        msg = llm.invoke(prompt)
        # 兼容 BaseMessage / str 两种返回
        if hasattr(msg, "content"):
            return str(msg.content).strip()
        return str(msg).strip()
    except Exception as e:  # noqa: BLE001
        logger.warning("[script] LLM 调用失败 model=%s: %r", model, e)
        return ""


# ─────────────────────────────────────────────────────────────────────
# 对外接口
# ─────────────────────────────────────────────────────────────────────


def generate_script(
    video_subject: str,
    *,
    language: str = "",
    paragraph_number: int = 1,
    model: Optional[str] = None,
) -> str:
    """LLM 生成视频文案。失败返空串。"""

    if not video_subject.strip():
        return ""
    prompt = _SCRIPT_PROMPT.format(
        video_subject=video_subject.strip(),
        language=language or "auto",
        paragraph_number=max(1, min(paragraph_number, 10)),
    )
    text = _invoke_llm(prompt, model=model)
    # 简单清洗:去除可能的 markdown 围栏 / 引号包裹
    text = re.sub(r"^```[a-z]*\n?|```$", "", text, flags=re.MULTILINE).strip()
    text = text.strip().strip('"').strip("'")
    return text


def generate_terms(
    video_subject: str,
    video_script: str,
    amount: int = 5,
    *,
    model: Optional[str] = None,
) -> List[str]:
    """LLM 生成英文搜索关键词列表(给 materials 在线搜索用)。"""

    if not video_subject.strip() and not video_script.strip():
        return []
    prompt = _TERMS_PROMPT.format(
        video_subject=video_subject.strip(),
        video_script=video_script.strip(),
        amount=max(1, min(amount, 30)),
    )
    raw = _invoke_llm(prompt, model=model)
    if not raw:
        return []
    # 容错:LLM 可能加 ``` 围栏 / 加前缀文字 / 输出对象 — 尝试摳出 [...]
    m = re.search(r"\[[\s\S]*?\]", raw)
    if not m:
        # fallback:按逗号/换行切
        items = re.split(r"[,\n]", raw)
        return [s.strip().strip('"').strip("'") for s in items if s.strip()][:amount]
    try:
        arr = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(arr, list):
        return []
    out: List[str] = []
    for item in arr:
        if isinstance(item, str) and item.strip():
            out.append(item.strip().lower())
    return out[:amount]

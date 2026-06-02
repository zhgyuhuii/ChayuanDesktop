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
# 多模态(商品图/视频)—— VLM 看图出带货文案
# ─────────────────────────────────────────────────────────────────────


_PRODUCT_IMG_EXTS = {"jpg", "jpeg", "png", "webp", "bmp"}
_PRODUCT_VIDEO_EXTS = {"mp4", "mov", "webm", "mkv"}

# 本地模型索引(model_registry.local_index)里,支持「看图」的 capability。
# identifier.py 把 VL/LLaVA/Qwen2-VL/带 vision_config 的模型判成 image-to-text。
_VISION_CAPABILITIES = {"image-to-text"}
# 明确「不支持图像输入」的纯文本/工具型 capability — 命中即可判定非 VLM。
# (chat 是最常见的误锁场景:用户锁了纯文本 chat 模型又挂了商品图。)
_NON_VISION_CAPABILITIES = {
    "chat", "text-embedding", "rerank", "speech-to-text", "text-to-audio",
    "text-to-image", "text-to-video", "image-embedding",
}


class VlmCapabilityError(ValueError):
    """所选模型经本地索引判定不支持图像输入。由路由层转人话给用户。"""


def _model_supports_vision(model: str) -> Optional[bool]:
    """尽力(best-effort)判断 model 是否支持图像输入。

    返回:
        * ``True``  — 本地索引判定为 image-to-text(VL 看图)
        * ``False`` — 本地索引判定为纯文本/工具型 capability(明确不支持图像)
        * ``None``  — 无法可靠判定(模型不在本地索引里,如远程 API 模型;
          或索引读取失败)。此时调用方不应据此拦截,继续 invoke。

    说明:本项目没有「给一个 model_id 同步问它支不支持视觉」的统一入口;
    唯一可靠的同步 capability 真源是 ``LocalModelIndex``(已下载模型的
    ``models.json``)。它能覆盖「用户锁了本地非 VLM 模型 + 挂图」这个最
    常见的误用场景。远程 API 模型(deepseek-chat / claude-* 等)不在索引里
    → 返回 None 不拦截,避免误伤真正支持视觉的 API 模型(交给 invoke 失败
    时的可读报错兜底)。
    """

    if not model:
        return None
    try:
        from chayuan.server.model_registry.local_index import LocalModelIndex
    except Exception as e:  # noqa: BLE001
        logger.debug("[script] LocalModelIndex import 失败,跳过 VLM 前置校验: %r", e)
        return None
    try:
        entry = LocalModelIndex().get(model)
    except Exception as e:  # noqa: BLE001
        logger.debug("[script] 本地索引查询失败,跳过 VLM 前置校验 model=%s: %r", model, e)
        return None
    if entry is None:
        # 不在本地索引(远程/API 模型,或仅 metadata 未下载) → 无法可靠判定
        return None
    cap = (entry.capability or "").strip()
    if cap in _VISION_CAPABILITIES:
        return True
    if cap in _NON_VISION_CAPABILITIES:
        return False
    return None


def _resolve_product_file(product_ref: str) -> Optional[str]:
    """``product:<fid>`` -> 商品目录下真实文件绝对路径(fid 末段含后缀)。"""

    import os

    from chayuan.server.video_generation._helpers import dh_products_dir

    ref = (product_ref or "").strip()
    if ref.startswith("product:"):
        ref = ref.split(":", 1)[1]
    fid = os.path.basename(ref)
    if not fid:
        return None
    path = os.path.join(dh_products_dir(), fid)
    if os.path.isfile(path):
        return path
    return None


def _ffmpeg_exe() -> str:
    """复用 /script/from-video 同款 ffmpeg 解析范式。"""

    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return "ffmpeg"


def _video_frames_data_urls(path: str, *, frames: int = 4) -> List[str]:
    """ffmpeg 均匀抽 ``frames`` 帧 -> base64 data URL 列表。失败/超时返 []。"""

    import base64
    import os
    import subprocess
    import tempfile

    out: List[str] = []
    tmpdir = tempfile.mkdtemp(prefix="dh_prod_frames_")
    try:
        ff = _ffmpeg_exe()
        # 每 3 秒取一帧,最多 frames 张(短视频也至少能取到首帧)
        pattern = os.path.join(tmpdir, "f_%02d.jpg")
        # timeout 兜底:损坏/超长视频会让 ffmpeg 卡死,进而挂死整个请求线程
        # (后端无 --reload 的同步 worker)。超时即放弃抽帧,回退纯文本路径。
        subprocess.run(
            [ff, "-y", "-i", path, "-vf", "fps=1/3",
             "-frames:v", str(max(1, frames)), pattern],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=60,
        )
        names = sorted(n for n in os.listdir(tmpdir) if n.endswith(".jpg"))
        for n in names[:max(1, frames)]:
            with open(os.path.join(tmpdir, n), "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
            out.append(f"data:image/jpeg;base64,{b64}")
    except subprocess.TimeoutExpired as e:
        logger.warning("[script] 视频抽帧超时(>60s) path=%s: %r — 回退纯文本", path, e)
        return []
    except Exception as e:  # noqa: BLE001
        logger.warning("[script] 视频抽帧失败 path=%s: %r", path, e)
        return []
    finally:
        try:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
    return out


def _product_image_data_urls(product_ref: str) -> List[str]:
    """商品 ref -> data URL 列表(图片单张;视频抽多帧)。无可用图像返 []。"""

    import base64
    import os

    path = _resolve_product_file(product_ref)
    if not path:
        logger.warning("[script] product_ref=%s 未找到对应文件", product_ref)
        return []
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext in _PRODUCT_IMG_EXTS:
        try:
            with open(path, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
        except Exception as e:  # noqa: BLE001
            logger.warning("[script] 读取商品图失败 path=%s: %r", path, e)
            return []
        mime = "jpeg" if ext == "jpg" else ext
        return [f"data:image/{mime};base64,{b64}"]
    if ext in _PRODUCT_VIDEO_EXTS:
        return _video_frames_data_urls(path)
    logger.warning("[script] 商品文件后缀不支持: %s", ext)
    return []


_PRODUCT_PROMPT_PREFIX = (
    "你是带货短视频文案专家。下面提供了商品的图片(可能是从一段商品视频抽取的多帧),"
    "请先观察图片中的商品外观/卖点/使用场景,再结合给定主题创作口播文案。"
    "只输出纯文案文本,不要前言后语,不要 markdown,不要加引号。"
    + chr(10) + chr(10)
)


def _invoke_llm_multimodal(
    prompt: str, image_data_urls: List[str], *, model: Optional[str] = None
) -> str:
    """构造含 image_url 的多模态 HumanMessage,走 get_ChatOpenAI VLM 看图出文案。

    invoke 前先做 best-effort VLM 能力校验(见 :func:`_model_supports_vision`):
    本地索引明确判定为「非视觉模型」时,直接抛 :class:`VlmCapabilityError`,
    由路由层转成可读错误「该模型不支持图像输入,请改用支持视觉(VLM)的模型」,
    而不是盲目 invoke 等一个笼统的下游错误。无法可靠判定(远程 API 模型)时
    照常 invoke,失败的报错信息里也带上「可能不支持图像」的可读提示。
    """

    if not image_data_urls:
        return ""
    try:
        from chayuan.server.utils import get_ChatOpenAI, get_default_llm
        from langchain_core.messages import HumanMessage
    except Exception as e:  # noqa: BLE001
        logger.error("[script] 多模态依赖 import 失败: %r", e)
        return ""

    if not model:
        try:
            from chayuan.server.capability_router import resolve_model
            model = resolve_model("chat") or get_default_llm()
        except Exception:  # noqa: BLE001
            model = get_default_llm()
    if not model:
        logger.error("[script] 多模态:没拿到可用 chat 模型")
        return ""

    # 前置 VLM 能力校验(best-effort,只在本地索引可靠判定为非视觉时拦截)
    supports = _model_supports_vision(model)
    if supports is False:
        logger.warning("[script] 多模态:模型 %s 经本地索引判定不支持图像输入", model)
        raise VlmCapabilityError(
            f"该模型({model})不支持图像输入,请改用支持视觉(VLM)的模型"
        )

    content: List[dict] = [{"type": "text", "text": _PRODUCT_PROMPT_PREFIX + prompt}]
    for url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": url}})

    try:
        llm = get_ChatOpenAI(model_name=model, temperature=0.7, streaming=False)
        msg = llm.invoke([HumanMessage(content=content)])
        if hasattr(msg, "content"):
            return str(msg.content).strip()
        return str(msg).strip()
    except VlmCapabilityError:
        raise
    except Exception as e:  # noqa: BLE001
        # 没能前置判定(远程 API 模型) → invoke 失败时把报错包装得更明确:
        # 多模态调用挂掉最常见的原因就是所选模型不支持图像。
        logger.warning("[script] 多模态 LLM 调用失败 model=%s: %r", model, e)
        raise VlmCapabilityError(
            f"多模态调用失败(model={model}):可能所选模型不支持图像输入,"
            f"请改用支持视觉(VLM)的模型。原始错误:{e}"
        ) from e


# ─────────────────────────────────────────────────────────────────────
# 对外接口
# ─────────────────────────────────────────────────────────────────────


def generate_script(
    video_subject: str,
    *,
    language: str = "",
    paragraph_number: int = 1,
    model: Optional[str] = None,
    product_ref: Optional[str] = None,
    kb_context: Optional[str] = None,
) -> str:
    """LLM 生成视频文案。失败返空串。

    ``product_ref`` 传 ``product:<fid>`` 时,从商品目录解析出图片/视频
    (视频抽多帧),走多模态 VLM 看图出带货文案;无则走纯文本路径。

    ``kb_context`` 非空时(由路由层从绑定知识库检索拼好),前置注入到
    prompt 主题提示前,作为「企业知识/参考话术」grounding。与 product_ref
    多模态分支可并存(都拼进同一段 prompt 文本)。

    多模态分支若判定所选模型不支持图像输入,会抛 :class:`VlmCapabilityError`
    给路由层转人话(不静默回退纯文本,避免「锁了非 VLM 还挂图」时用户拿到
    一段没看图的文案却不知道为什么)。
    """

    if not video_subject.strip():
        return ""
    prompt = _SCRIPT_PROMPT.format(
        video_subject=video_subject.strip(),
        language=language or "auto",
        paragraph_number=max(1, min(paragraph_number, 10)),
    )
    if kb_context and kb_context.strip():
        prompt = f"【企业知识/参考话术】\n{kb_context.strip()}\n\n" + prompt
    if product_ref:
        data_urls = _product_image_data_urls(product_ref)
        if data_urls:
            text = _invoke_llm_multimodal(prompt, data_urls, model=model)
        else:
            logger.warning("[script] product_ref=%s 未解析到可用图像,回退纯文本", product_ref)
            text = _invoke_llm(prompt, model=model)
    else:
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

"""langchain-openai 兼容性补丁。

----- thinking-mode reasoning_content 回传 -----

DeepSeek / Qwen / 阶跃 等带 thinking-mode 的模型,API 在 ``assistant`` 消息里
返回 ``reasoning_content`` 字段;**下一轮请求**(典型场景:工具调用回路,把 tool
结果拼回去再问)必须把 **同一条 assistant** 消息的 ``reasoning_content`` **原样
回传**,否则 API 直接返回 400::

    {"error": {"message": "The `reasoning_content` in the thinking mode must
                          be passed back to the API.",
               "type": "invalid_request_error", ...}}

langchain-openai 的 ``_convert_message_to_dict`` 把 ``AIMessage`` 转 OpenAI
chat completions dict 时,只复制 ``content`` / ``tool_calls`` / ``role``,
不会把 ``additional_kwargs.reasoning_content`` 透传。我们 monkey-patch 一下,
在 assistant 这条 dict 里塞回该字段,API 就满意了。

非 thinking 模型不受影响:``additional_kwargs.reasoning_content`` 为空 / 不存在
时 patch 不写任何键。
"""
from __future__ import annotations

import logging

logger = logging.getLogger("chayuan.compat.langchain_openai")


def _apply_reasoning_content_passthrough() -> None:
    try:
        from langchain_openai.chat_models import base as _m
    except Exception as e:  # noqa: BLE001
        logger.warning("langchain_openai 未装,跳过 reasoning_content patch:%r", e)
        return

    orig = getattr(_m, "_convert_message_to_dict", None)
    if orig is None:
        logger.warning("langchain_openai._convert_message_to_dict 未找到,跳过 patch")
        return

    if getattr(orig, "_chayuan_reasoning_patched", False):
        return  # 已 patch 过,幂等

    def _patched(message, api="chat/completions"):
        out = orig(message, api=api)
        try:
            if isinstance(out, dict) and out.get("role") == "assistant":
                ak = getattr(message, "additional_kwargs", None) or {}
                rc = ak.get("reasoning_content")
                if rc:
                    # 兼容 dict / str:DeepSeek 是 str,Qwen 部分版本会嵌 list,这里都原样回传
                    out["reasoning_content"] = rc
        except Exception:  # noqa: BLE001
            logger.exception("reasoning_content patch 异常,降级走原始 dict")
        return out

    _patched._chayuan_reasoning_patched = True  # type: ignore[attr-defined]
    _m._convert_message_to_dict = _patched
    logger.info("已注入 reasoning_content 回传 patch(thinking-mode 工具调用回路兼容)")


_apply_reasoning_content_passthrough()

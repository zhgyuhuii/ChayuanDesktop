from __future__ import annotations

from typing import Any

# OpenAI finish_reason → Anthropic stop_reason
_FINISH_MAP = {"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use"}


def _flatten_content(content: Any) -> str:
    """Anthropic content 可为 str 或 [{type:text,text}]；OpenAI 兼容网关只吃 str。"""
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts)


def anthropic_to_openai(req: dict) -> dict:
    """Anthropic /v1/messages 请求体 → 察元 OpenAI /v1/chat/completions 请求体。"""
    messages = []
    if req.get("system"):
        messages.append({"role": "system", "content": req["system"]})
    for m in req.get("messages", []):
        messages.append({"role": m["role"], "content": _flatten_content(m["content"])})
    out: dict[str, Any] = {"model": req["model"], "messages": messages}
    if "max_tokens" in req:
        out["max_tokens"] = req["max_tokens"]
    if "temperature" in req:
        out["temperature"] = req["temperature"]
    return out


def openai_to_anthropic(resp: dict, model: str) -> dict:
    """察元 OpenAI 响应 → Anthropic /v1/messages 响应体。"""
    choice = (resp.get("choices") or [{}])[0]
    text = choice.get("message", {}).get("content", "") or ""
    finish = choice.get("finish_reason", "stop")
    usage = resp.get("usage", {})
    return {
        "id": resp.get("id", "msg_shim"),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}],
        "stop_reason": _FINISH_MAP.get(finish, "end_turn"),
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }

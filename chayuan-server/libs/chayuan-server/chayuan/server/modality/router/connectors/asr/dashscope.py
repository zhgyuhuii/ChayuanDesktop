"""DashScope native ASR Connector — qwen3-asr-flash / qwen-asr / paraformer。

为什么不复用 OpenAI 兼容
========================

DashScope 的 ``/compatible-mode/v1`` 没有 ``/audio/transcriptions`` 端点;ASR
跟 TTS / image 一样,只在 native ``/api/v1/services/aigc/multimodal-generation``
上发布,而且请求体跟 OpenAI Whisper 的 multipart 完全不同 —— DashScope 走
JSON,把音频以 ``data:<mime>;base64,...`` URL 形态塞进 ``input.messages``
里的 ``content`` 块。

::

    POST /api/v1/services/aigc/multimodal-generation/generation
    {
      "model": "qwen3-asr-flash",
      "input": {
        "messages": [
          {"role": "system", "content": [{"text": ""}]},
          {"role": "user",   "content": [{"audio": "data:audio/wav;base64,..."}]}
        ]
      },
      "parameters": {
        "asr_options": {
          "enable_lid":  true,    # language id 自动识别语种
          "enable_itn":  false,   # inverse text normalization,默认关
          "language":    "zh"     # 可选,强制指定语言 → 跳过 lid
        }
      }
    }

响应:
::

    {
      "output": {
        "choices": [
          {
            "finish_reason": "stop",
            "message": {
              "role": "assistant",
              "content": [{"text": "识别的文字"}]
            }
          }
        ]
      },
      "usage": {"audio_tokens": ..., "input_tokens": ..., "output_tokens": ...}
    }

音频大小限制
============
qwen3-asr-flash 单次最长 3 分钟 / 10MB,超长场景需要切片 — 本 Connector 不做切片,
让用户在前端切好或选 paraformer-realtime-v2 走流式(本 PR 暂不支持流式)。

paraformer 系列
===============
paraformer-realtime-v2 / paraformer-v2 是异步 + 流式的录音文件转写,有自己专属
的 async-task 端点(``/api/v1/services/audio/asr/transcription``)。本 Connector
当前只覆盖 qwen3-asr-flash / qwen-asr-* 的 multimodal-generation 同步路径;
paraformer 流式后续补单独的连接器。
"""

from __future__ import annotations

import base64
import logging
import re
from typing import AsyncIterator, Dict, Optional
from urllib.parse import urlparse

import httpx

from chayuan.server.modality.router.artifacts import find_by_filename
from chayuan.server.modality.router.connectors.base import Connector, register
from chayuan.server.modality.router.protocol import Capability, GenerateReq
from chayuan.server.modality.router.sse_v5 import (
    data_part,
    error_event,
    text_delta,
    text_end,
    text_start,
)

logger = logging.getLogger("chayuan.modality.connectors.asr.dashscope")


def _build_endpoint(api_base: str) -> str:
    base = (api_base or "").rstrip("/")
    if base.endswith("/api/v1"):
        return f"{base}/services/aigc/multimodal-generation/generation"
    base = re.sub(r"/compatible-mode/v\d+$", "", base)
    base = re.sub(r"/v\d+$", "", base)
    return f"{base}/api/v1/services/aigc/multimodal-generation/generation"


def _resolve_local_audio(url: str) -> Optional[tuple[bytes, str]]:
    """从 ``/v1/artifacts/<sha>.<ext>`` URL 反查本地文件 → (bytes, mime)。"""
    try:
        path = urlparse(url).path
    except Exception:  # noqa: BLE001
        return None
    if not path.startswith("/v1/artifacts/"):
        return None
    filename = path.rsplit("/", 1)[-1]
    local = find_by_filename(filename)
    if not local or not local.is_file():
        return None
    try:
        raw = local.read_bytes()
    except OSError as e:
        logger.warning("[asr.dashscope] cannot read artifact %s: %r", local, e)
        return None
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
    mime_map = {
        "mp3":  "audio/mpeg",
        "wav":  "audio/wav",
        "m4a":  "audio/mp4",
        "ogg":  "audio/ogg",
        "webm": "audio/webm",
        "flac": "audio/flac",
        "opus": "audio/ogg",
        "amr":  "audio/amr",
    }
    return raw, mime_map.get(ext, "audio/wav")


def _to_data_url(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


@register(Capability.ASR, "dashscope")
class DashScopeASRConnector(Connector):
    """qwen3-asr-flash / qwen-asr-* — DashScope native multimodal-generation。"""

    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        if not req.attachments:
            yield error_event("ASR 必须上传一段音频文件", code="missing_audio")
            return
        ref = req.attachments[0]
        if not (ref.mime or "").startswith("audio/"):
            yield error_event(
                f"附件必须是音频类型(当前 mime={ref.mime})",
                code="invalid_audio_mime",
            )
            return
        resolved = _resolve_local_audio(ref.url or "")
        if not resolved:
            yield error_event("音频文件已过期或读取失败,请重新上传", code="audio_unreadable")
            return
        audio_bytes, audio_mime = resolved
        # qwen3-asr-flash 上限 10MB / 3 分钟 — 本地先粗校验大小,避免无谓上传
        if len(audio_bytes) > 10 * 1024 * 1024:
            yield error_event(
                f"音频文件过大({len(audio_bytes)/1024/1024:.1f}MB),qwen3-asr-flash 限 10MB / 3 分钟",
                code="audio_too_large",
            )
            return

        text_id = "t0"
        yield text_start(text_id)
        yield text_delta(text_id, "")  # 触发 UI 进入流式态
        yield data_part("task-progress", {"percent": 20, "message": "提交识别请求"})

        # 参数
        # language:用户显式指定 → 关 lid;否则开 lid 让模型自动判断
        # enable_itn:是否做数字/单位标准化("二零二六" → "2026")
        language = req.params.get("language") or req.params.get("lang")
        enable_itn = bool(req.params.get("enable_itn", False))

        asr_options: Dict = {"enable_itn": enable_itn}
        if language:
            asr_options["language"] = str(language)
            asr_options["enable_lid"] = False
        else:
            asr_options["enable_lid"] = True

        body: Dict = {
            "model": req.model,
            "input": {
                "messages": [
                    {"role": "system", "content": [{"text": ""}]},
                    {
                        "role": "user",
                        "content": [{"audio": _to_data_url(audio_bytes, audio_mime)}],
                    },
                ]
            },
            "parameters": {"asr_options": asr_options},
        }
        headers = {
            "Authorization": f"Bearer {req.api_key}",
            "Content-Type": "application/json",
        }

        endpoint = _build_endpoint(req.api_base)
        # qwen3-asr-flash 同步;3 分钟音频典型延迟 5-30 秒
        timeout = httpx.Timeout(connect=10.0, read=180.0, write=60.0, pool=10.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(endpoint, json=body, headers=headers)
        except httpx.RequestError as e:
            yield error_event(
                f"无法连接 DashScope ASR 接口: {e}",
                code="upstream_unreachable",
            )
            return

        if resp.status_code != 200:
            try:
                err_body = resp.json()
            except ValueError:
                err_body = {"raw": resp.text[:500]}
            msg = err_body.get("message") or err_body
            yield error_event(
                f"DashScope ASR {resp.status_code}: {msg}",
                code=f"upstream_{resp.status_code}",
            )
            return

        data = resp.json()
        output = data.get("output") or {}
        # qwen3-asr-flash 标准 chat-shape:output.choices[0].message.content[0].text
        text_out = ""
        detected_lang: Optional[str] = None
        choices = output.get("choices") or []
        if choices:
            msg = (choices[0] or {}).get("message") or {}
            content = msg.get("content")
            if isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and isinstance(blk.get("text"), str):
                        text_out += blk["text"]
            elif isinstance(content, str):
                text_out = content
        # 老 ASR 兜底:有些模型平铺在 output.text
        if not text_out and isinstance(output.get("text"), str):
            text_out = output["text"]
        # 部分模型回 language id
        if isinstance(output.get("language"), str):
            detected_lang = output["language"]

        text_out = text_out.strip()
        if not text_out:
            yield error_event(
                "ASR 返回空文本(音频可能太短 / 全静音 / 无语音)",
                code="empty_transcript",
            )
            return

        yield data_part("task-progress", {"percent": 90, "message": "解析转写结果"})
        yield text_delta(text_id, text_out)
        yield text_end(text_id)

        usage = data.get("usage") or {}
        meta: Dict = {
            "audio_chars": len(text_out),
            "audio_size_bytes": len(audio_bytes),
            "model": req.model,
        }
        if detected_lang:
            meta["language"] = detected_lang
        for k, v in usage.items():
            if isinstance(v, (int, float, str)):
                meta[k] = v
        yield data_part("usage", meta)
        yield data_part("task-progress", {"percent": 100, "message": "完成"})

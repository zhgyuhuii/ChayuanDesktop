"""推理引擎子进程启动参数解析。

为什么需要
==========

``supervisor.yaml`` 里的 ``llamacpp`` / ``infinity`` / ``ollama`` 进程被启动
时,**默认没有绑定具体模型** —— ``llama-server`` 不带 ``--model``,启动起来
也不能服务请求;``infinity`` 不带 ``--model-name-or-path``,起来等于空跑。

本模块给出"按 capability defaults + local_index 解析出该进程应该用哪个模型
文件"的纯逻辑层。supervisor 在拉起子进程前调一次:

* :func:`resolve_llamacpp_args` → 额外 args ``["--model", "<gguf path>", ...]``
* :func:`resolve_infinity_args` → 额外 args ``["--model-id", "<repo or path>"]``
* :func:`resolve_ollama_env`    → 环境变量 ``{"OLLAMA_MODELS": "<dir>"}``

解析顺序
========

1. 读 :mod:`config_panel` 的 capability defaults(用户在 GUI 选的);
2. 用 :mod:`local_index` 把 model_id 反查成磁盘路径;
3. 若解析失败:返回空 args / 空 env;子进程仍能启动,但需要前端 GUI 引导
   用户选模型(:func:`resolve_*` 同时返回 :class:`Resolution` 报告字段
   ``reason``,便于排错)。

本模块**纯函数化**:不写盘、不启动进程、不调 supervisor;留给上层调用方做
集成 —— 这样 B2.5 阶段可以独立单测,B3 / B5 / B6 都能复用同一份解析。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from chayuan.server.model_registry.local_index import (
    LocalModelEntry,
    get_local_index,
)

logger = logging.getLogger("chayuan.model_registry.process_args")


@dataclass
class Resolution:
    """单个 process 的参数解析结果。"""

    process: str
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    resolved_models: Dict[str, str] = field(default_factory=dict)   # cap -> model_id
    missing: List[str] = field(default_factory=list)                 # 没解析出来的 cap
    reason: str = ""                                                 # 人类可读说明

    @property
    def ok(self) -> bool:
        """``True`` 时 args / env 已经准备好;``False`` 时调用方应该 fallback。"""
        return not self.missing and (bool(self.args) or bool(self.env))

    def to_dict(self) -> dict:
        return {
            "process": self.process,
            "args": list(self.args),
            "env": dict(self.env),
            "resolved_models": dict(self.resolved_models),
            "missing": list(self.missing),
            "reason": self.reason,
            "ok": self.ok,
        }


# ───────────────────────── 公共工具 ─────────────────────────


def _load_defaults() -> Dict[str, str]:
    """读 ``model_settings.yaml`` 的 capability defaults。失败时返回空 dict,
    不抛 —— 解析阶段必须容错。"""
    try:
        from chayuan.server.config_panel.runtime_framework_panel import (
            _load_capability_defaults,
        )
        return dict(_load_capability_defaults() or {})
    except Exception as e:  # noqa: BLE001
        logger.debug("[process_args] _load_capability_defaults 失败: %r", e)
        return {}


def _lookup_local(model_id: str) -> Optional[LocalModelEntry]:
    """按 model_id 反查 :mod:`local_index`。"""
    if not model_id:
        return None
    try:
        return get_local_index().get(model_id)
    except Exception as e:  # noqa: BLE001
        logger.debug("[process_args] local_index.get 失败: %r", e)
        return None


def _pick_by_capability_local_only(
    local_cap: str,
    *,
    prefer_format: Optional[str] = None,
) -> Optional[LocalModelEntry]:
    """从 local_index 按 capability 找一个候选(default 缺失时的兜底)。

    Args:
        local_cap: identifier 用的 capability 字符串。
        prefer_format: 若指定,优先返回该 ``format`` 的条目(例如 llama.cpp
            必须 ``gguf``;infinity 偏好 ``hf_transformers``)。
    """
    try:
        cands = get_local_index().by_capability(local_cap)
    except Exception as e:  # noqa: BLE001
        logger.debug("[process_args] by_capability 失败: %r", e)
        return None
    if not cands:
        return None
    if prefer_format:
        for c in cands:
            if c.format == prefer_format:
                return c
    return cands[0]


def _resolve(panel_cap: str, *, prefer_format: Optional[str] = None,
             local_cap: Optional[str] = None) -> Tuple[Optional[LocalModelEntry], str]:
    """通用解析:default(panel_cap) → local_index 反查;失败时按 capability
    兜底选第一个本地候选。

    Args:
        panel_cap: ``CAPABILITY_LABELS`` 短名(``chat`` / ``embedding`` / ``rerank``)。
        prefer_format: 兜底匹配时偏好的 ``format`` 字段。
        local_cap: 兜底时使用的 local_index capability 字符串;不传则由
            :data:`candidates_bridge.LOCAL_TO_PANEL_CAP` 反查。

    Returns:
        ``(entry, reason)``;``entry`` 可能为 None。
    """
    defaults = _load_defaults()
    mid = defaults.get(panel_cap) or ""

    if mid:
        e = _lookup_local(mid)
        if e is not None:
            return e, f"resolved by default model_id={mid!r}"

    # 兜底:按 capability 在 local_index 里挑第一条
    if not local_cap:
        from chayuan.server.model_registry.candidates_bridge import (
            LOCAL_TO_PANEL_CAP,
        )
        for k, v in LOCAL_TO_PANEL_CAP.items():
            if v == panel_cap:
                local_cap = k
                break
    if not local_cap:
        return None, f"no local capability mapped for panel cap {panel_cap!r}"

    e = _pick_by_capability_local_only(local_cap, prefer_format=prefer_format)
    if e is not None:
        return e, (
            f"fallback by capability {local_cap!r}"
            + (f" prefer_format={prefer_format!r}" if prefer_format else "")
        )
    return None, f"no local candidate for {local_cap!r}"


# ───────────────────────── llamacpp ─────────────────────────

_LLAMACPP_CAPABILITIES = ("chat", "embedding", "rerank")
_LLAMACPP_LOCAL_CAP_MAP = {
    "chat": "chat",
    "embedding": "text-embedding",
    "rerank": "rerank",
}


def resolve_llamacpp_args(
    *,
    capability: str = "chat",
    n_threads: Optional[int] = None,
    n_gpu_layers: Optional[int] = None,
    n_ctx: int = 4096,
) -> Resolution:
    """``llama-server`` 启动时需要的额外 args(在 supervisor.yaml 原有 host/port
    之外追加)。

    capability:
      * ``chat``      → chat default + GGUF + --ctx-size
      * ``embedding`` → text-embedding default + GGUF + --embedding --pooling cls
      * ``rerank``    → rerank default + GGUF + --reranking
    """
    if capability not in _LLAMACPP_CAPABILITIES:
        raise ValueError(f"Unknown capability for llamacpp: {capability!r}")

    local_cap = _LLAMACPP_LOCAL_CAP_MAP[capability]
    r = Resolution(process="llamacpp")
    entry, reason = _resolve(capability, prefer_format="gguf", local_cap=local_cap)
    if entry is None or entry.format != "gguf":
        r.missing.append(capability)
        r.reason = reason if entry is None else (
            f"{capability} model {entry.model_id!r} format={entry.format!r} 不是 gguf"
        )
        return r

    r.args.extend(["--model", entry.path])
    if capability == "chat":
        r.args.extend(["--ctx-size", str(int(n_ctx))])
    elif capability == "embedding":
        r.args.extend(["--embedding", "--pooling", "cls"])
    elif capability == "rerank":
        r.args.extend(["--reranking"])

    if n_threads is not None:
        r.args.extend(["--threads", str(int(n_threads))])
    if n_gpu_layers is not None:
        r.args.extend(["--n-gpu-layers", str(int(n_gpu_layers))])
    r.resolved_models[capability] = entry.model_id
    r.reason = reason
    return r


# ───────────────────────── infinity ─────────────────────────

_INFINITY_CAPABILITIES = ("image-embedding",)
_INFINITY_LOCAL_CAP_MAP = {
    "image-embedding": "image",
}


def resolve_infinity_args(
    *,
    capability: str = "image-embedding",
    n_threads: Optional[int] = None,
) -> Resolution:
    """``infinity_server`` (Python sidecar) 启动 args。

    capability:
      * ``image-embedding`` → image default + transformers/safetensors 模型 + --model
    """
    if capability not in _INFINITY_CAPABILITIES:
        raise ValueError(f"Unknown capability for infinity: {capability!r}")

    local_cap = _INFINITY_LOCAL_CAP_MAP[capability]
    r = Resolution(process="infinity")
    entry, reason = _resolve(capability, local_cap=local_cap)
    if entry is None:
        r.missing.append(capability)
        r.reason = reason
        return r

    # Python sidecar: 用 `-m <module>` 而非 binary 直跑
    r.args.extend([
        "-m", "chayuan.server.image_source.infinity_server",
        "--model", entry.model_id,
    ])
    if n_threads is not None:
        r.args.extend(["--threads", str(int(n_threads))])
    r.resolved_models[capability] = entry.model_id
    r.reason = reason
    return r


# ───────────────────────── ollama ─────────────────────────


def resolve_ollama_env(*, models_dir: Optional[str] = None) -> Resolution:
    """``ollama`` 通过 ``OLLAMA_MODELS`` 环境变量指定模型仓库根目录。

    Args:
        models_dir: 显式传 dir 覆盖;不传则从 :func:`local_index.models_dir`
            的 chat 子目录推导(layout.yaml 约定 chat 模型释放到
            ``<CHAYUAN_ROOT>/models/chat/``)。
    """
    r = Resolution(process="ollama")
    if models_dir:
        r.env["OLLAMA_MODELS"] = str(models_dir)
        r.reason = "explicit models_dir"
        return r

    try:
        from chayuan.server.model_registry.local_index import models_dir as md
        chat_dir = md() / "chat" / "_ollama"
        r.env["OLLAMA_MODELS"] = str(chat_dir)
        r.reason = f"derived from models_dir() = {chat_dir!s}"
    except Exception as e:  # noqa: BLE001
        r.missing.append("ollama_models_dir")
        r.reason = f"failed to derive: {e!r}"
    return r


# ───────────────────────── whispercpp ─────────────────────────

_WHISPER_CAPABILITIES = ("asr",)
_WHISPER_LOCAL_CAP_MAP = {
    "asr": "asr",
}


def resolve_whisper_args(
    *,
    capability: str = "asr",
    n_threads: Optional[int] = None,
) -> Resolution:
    """``whisper-server`` 启动时的 args。

    capability:
      * ``asr`` → asr default + ggml 模型 + --model <path>
    """
    if capability not in _WHISPER_CAPABILITIES:
        raise ValueError(f"Unknown capability for whisper: {capability!r}")

    local_cap = _WHISPER_LOCAL_CAP_MAP[capability]
    r = Resolution(process="whispercpp")
    entry, reason = _resolve(capability, prefer_format="ggml", local_cap=local_cap)
    if entry is None or entry.format != "ggml":
        r.missing.append(capability)
        r.reason = reason if entry is None else (
            f"{capability} model {entry.model_id!r} format={entry.format!r} 不是 ggml"
        )
        return r

    r.args.extend(["--model", entry.path])
    if n_threads is not None:
        r.args.extend(["--threads", str(int(n_threads))])
    r.resolved_models[capability] = entry.model_id
    r.reason = reason
    return r


# ───────────────────────── 集成入口 ─────────────────────────


def resolve_all() -> Dict[str, Resolution]:
    """一次跑完三个推理引擎的解析。

    给 supervisor 启动钩子 / admin 调试接口用。结果是只读快照,**不会**写盘
    或重启进程。
    """
    return {
        "llamacpp": resolve_llamacpp_args(),
        "infinity": resolve_infinity_args(),
        "ollama":   resolve_ollama_env(),
    }


__all__ = [
    "Resolution",
    "resolve_llamacpp_args",
    "resolve_infinity_args",
    "resolve_ollama_env",
    "resolve_whisper_args",
    "resolve_all",
]

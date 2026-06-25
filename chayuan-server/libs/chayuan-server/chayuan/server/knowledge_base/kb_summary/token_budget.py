"""全文总结的上下文预算工具(纯逻辑,不依赖 langchain)。

本地 chat 模型仅 4096 上下文(process_args.py 默认 --ctx-size 4096),旧
SummaryAdapter 不做预算 → map 阶段并行发超长 prompt → llama-server 抛
「Context size has been exceeded」。本模块提供保守的中文 token 估算与按
n_ctx 推导的输入/输出预算,供 summary_chunk.py 切块与分组使用。
"""
from __future__ import annotations

import math
from typing import Tuple

DEFAULT_CTX: int = 4096
# 云端模型在 model_metadata 查不到 context_length 时的默认。取 32768:几乎所有主流云端
# chat 模型真实 ctx 都 ≥32K(DeepSeek 64K、Qwen/GLM/Kimi/GPT 等 32K~200K),用 32768 既
# 不会溢出,又能让绝大多数文档走「单次整篇」快路径(1 次调用)而非退化成多次 map-reduce。
# ⚠ 早期取 8192 过于保守:小文档(如几页答辩状)估算 token 仍 >8192 单次预算 → 被迫
# map-reduce 多次往返 → 慢(2.0.317 实测 deepseek-v4-pro 仍 3 次调用 26s)。能查到真实
# context_length 时永远优先用真实值;这只是查不到时的兜底。
CLOUD_DEFAULT_CTX: int = 32768
MAP_MAX_TOKENS: int = 384
REDUCE_MAX_TOKENS: int = 768
# map 阶段并行度上限,**仅用于云端模型**(见 map_concurrency_for)。云端每个请求是
# 独立上下文、能真正并发,并行发 N 个 map 请求可成倍提速。
# ⚠ 本地模型一律被 map_concurrency_for 强制为 1:本地只有一个 llama-server,llama.cpp
# 把并发请求连续批处理、**共享同一个 n_ctx KV 缓存**——并行发 N 个各 ~budget token 的
# prompt 会 N×budget 远超 ctx → "Context size has been exceeded"(2.0.310 教训)。
MAP_CONCURRENCY: int = 4
_TEMPLATE_OVERHEAD: int = 96
_SAFETY_MARGIN: int = 256


def _is_cjk(ch: str) -> bool:
    o = ord(ch)
    return (
        0x4E00 <= o <= 0x9FFF      # CJK Unified Ideographs
        or 0x3400 <= o <= 0x4DBF   # CJK Extension A
        or 0x3000 <= o <= 0x303F   # CJK symbols & punctuation
        or 0xFF00 <= o <= 0xFFEF   # fullwidth forms & punctuation
        or 0xF900 <= o <= 0xFAFF   # CJK Compatibility Ideographs
    )


def estimate_tokens(text: str) -> int:
    """保守(偏高)估算 token 数。中文/CJK 按 1 token/字,其余按 4 字符/token,
    再取与「总字符数/3」的较大者作上界。"""
    if not text:
        return 0
    cjk = sum(1 for ch in text if _is_cjk(ch))
    other = len(text) - cjk
    est = cjk + math.ceil(other / 4)
    return max(est, math.ceil(len(text) / 3))


def _bare_id(model_name: str | None) -> str:
    """剥掉 platform::model 命名空间,返回裸 model_id。"""
    name = (model_name or "").strip()
    return name.split("::", 1)[1].strip() if "::" in name else name


def _is_local_model(model_name: str | None) -> bool:
    """本地/bundled 模型:实际跑本地单一 llama-server(`--ctx-size` 默认 4096、
    并发请求共享同一 n_ctx KV 缓存)。云端模型反之。"""
    low = _bare_id(model_name).lower()
    return low.startswith("models/") or low.startswith("local-") or "bundled" in low


def map_concurrency_for(model_name: str | None) -> int:
    """map 阶段并行度:本地单 llama-server 共享 ctx → 串行(1)避免溢出;
    云端模型每请求独立 ctx 且能真正并发 → 并行(MAP_CONCURRENCY)提速。"""
    return 1 if _is_local_model(model_name) else MAP_CONCURRENCY


def resolve_model_ctx(model_name: str | None) -> int:
    """解析模型有效上下文窗口;拿不到则保守取 DEFAULT_CTX。

    按裸 model_id 在 model_metadata 里查 context_length;查不到 / 无 DB / 任何
    异常 → DEFAULT_CTX(本地 chat 默认 4096,保守不溢出)。
    """
    bare = _bare_id(model_name)
    if not bare:
        return DEFAULT_CTX
    # ⚠ 本地/bundled 模型实际跑的是 llama-server `--ctx-size`(默认 4096),不能用
    # model_metadata 的 context_length(那是模型训练上下文,如 32768)——否则预算
    # 远超运行时窗口 → Context size exceeded + 重试 + 巨慢。本地一律用 DEFAULT_CTX。
    if _is_local_model(model_name):
        return DEFAULT_CTX
    name = (model_name or "").strip()
    try:
        from chayuan.server.db.repository import model_metadata_repository as _mmr
        for md in (_mmr.list_all() or []):
            if not isinstance(md, dict):
                continue
            if str(md.get("model_id") or "") in (bare, name):
                ctx = md.get("context_length")
                if ctx and int(ctx) > 0:
                    return int(ctx)
    except Exception:  # noqa: BLE001 — 无 DB / 异常一律保守回退
        pass
    # 云端模型查不到真实 ctx:用 CLOUD_DEFAULT_CTX(8192)而非 4096,使典型文档仍能单次整篇
    return CLOUD_DEFAULT_CTX


def map_input_char_budget(ctx: int) -> Tuple[int, int]:
    """返回 (输入 token 预算, 输入字符预算上界) 供 map 阶段切块。
    字符预算用最保守口径(1 token/字)反推。"""
    # 防御性下限;本系统 ctx 恒 >= 4096,不会触发
    budget_tokens = max(256, ctx - MAP_MAX_TOKENS - _TEMPLATE_OVERHEAD - _SAFETY_MARGIN)
    return budget_tokens, budget_tokens


def reduce_group_token_budget(ctx: int) -> int:
    """reduce 合并阶段:一组待合并摘要的 token 预算上界。"""
    # 防御性下限;本系统 ctx 恒 >= 4096,不会触发
    return max(256, ctx - REDUCE_MAX_TOKENS - _TEMPLATE_OVERHEAD - _SAFETY_MARGIN)

"""调度器·模型分层路由 + 涉密强制路由（纯逻辑）。

- 分层升档：默认 Sonnet；连败达阈值（默认 2）升 Opus 并带失败上下文重投。
- 涉密红线：classification=secret → 不进 DMZ 流水线、不派 DMZ 数字员工，强制走本地 vLLM；
  非涉密走 LiteLLM 网关（统一出口/计量/熔断）。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RouteDecision:
    dispatchable: bool  # DMZ 调度器能否派此单（涉密单为 False，留内网本地处理）
    model_tier: str  # "sonnet" | "opus" | "local-vllm"
    gateway: str  # "litellm" | "local-vllm"
    reason: str | None


def route(classification: str, fail_streak: int, *, escalate_after: int = 2) -> RouteDecision:
    if classification == "secret":
        # 涉密：全程留内网 + 仅本地 vLLM，DMZ 调度器强制拦截不派。
        return RouteDecision(False, "local-vllm", "local-vllm", "secret_local_only")
    if fail_streak >= escalate_after:
        return RouteDecision(True, "opus", "litellm", "escalated")
    return RouteDecision(True, "sonnet", "litellm", None)


__all__ = ["RouteDecision", "route"]

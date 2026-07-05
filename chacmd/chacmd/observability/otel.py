from __future__ import annotations

import os


def inject_traceparent(message: dict, job_id: str, trace_id: str | None = None) -> dict:
    """给总线消息注入 W3C traceparent + baggage(job_id)（NFR-O1 最小实现）。

    无 opentelemetry 依赖时用 job_id 派生的确定性 trace_id（真实部署由 SDK 生成）。
    返回新 dict，不修改入参。
    """
    tid = trace_id or (job_id.replace("-", "")[:32].ljust(32, "0"))
    span_id = "0" * 16
    out = dict(message)
    out["traceparent"] = f"00-{tid}-{span_id}-01"
    out["baggage"] = {"job_id": job_id}
    return out


def init_tracing(service_name: str = "chacmd") -> None:
    """装了 opentelemetry-sdk 则初始化；否则 no-op（P0 最小可运行）。"""
    if os.environ.get("CHACMD_OTEL_DISABLED"):
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider

        trace.set_tracer_provider(TracerProvider())
    except Exception:
        pass  # 依赖缺失时静默降级

"""性能指标 REST(admin)。挂 /api/v1/admin/metrics。"""
from __future__ import annotations

from fastapi import APIRouter

from chayuan.server.api_server.api_schemas import BaseResponse
from chayuan.server.admin.metrics import collect_hardware_snapshot
from chayuan.server.auth.deps import require_role
from fastapi import Depends

metrics_router = APIRouter(prefix="/api/v1/admin/metrics", tags=["admin-metrics"])


@metrics_router.get("/hardware", response_model=BaseResponse)
async def hardware_metrics():
    return {"data": collect_hardware_snapshot()}


_ADMIN = require_role("admin")


@metrics_router.get("/scalability", summary="[admin] 可扩展性诊断(静态配置体检+并发承载估算)")
def scalability_report(_=Depends(_ADMIN)):
    """复用 config_panel/scalability.build_report():只读分析 basic/kb/model settings,
    返回 17 项体检(severity critical/warning/info/ok + impact + fix_hint + snippet)
    + 并发承载档位估算 + 评分。无副作用。"""
    from chayuan.server.config_panel.scalability import build_report
    try:
        rep = build_report()
    except Exception as e:  # noqa: BLE001
        return {"code": 1, "msg": f"诊断失败：{e}", "data": {"checks": [], "mode": "dev", "score": 0, "est_concurrent_users": ""}}
    checks = [
        {
            "key": c.key,
            "title": c.title,
            "severity": c.severity,
            "summary": c.summary,
            "impact": c.impact,
            "fix_hint": c.fix_hint,
            "snippet": c.snippet,
            "snippet_lang": c.snippet_lang,
        }
        for c in rep.checks
    ]
    counts = {"critical": 0, "warning": 0, "info": 0, "ok": 0}
    for c in rep.checks:
        if c.severity in counts:
            counts[c.severity] += 1
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "checks": checks,
            "mode": rep.mode,
            "score": rep.score,
            "est_concurrent_users": rep.est_concurrent_users,
            "counts": counts,
        },
    }

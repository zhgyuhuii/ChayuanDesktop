"""自定义工具「测试调用」(框架无关)。港自 config_panel.custom_tools_page._do_test。

构造样本参数(param_values 优先,回落 default,required 缺省占位)→ 代入 url/body →
shared.http_test.run_request。返回 ProbeResult.to_dict()。
"""
from __future__ import annotations

import json
from typing import Any, Dict

from chayuan.server.shared.http_test import run_request


def _placeholder(ptype: str) -> Any:
    if ptype == "integer":
        return 1
    if ptype == "number":
        return 1.0
    if ptype == "boolean":
        return True
    return "?"


def build_and_run(spec: Any, param_values: Dict[str, Any] | None) -> dict:
    """spec=CustomToolSpec(.params/.url/.method/.headers/.body_template/.timeout)。"""
    pv = param_values or {}
    sample: Dict[str, Any] = {}
    for p in spec.params:
        if p.name in pv and pv[p.name] not in (None, ""):
            sample[p.name] = pv[p.name]
        elif p.default is not None:
            sample[p.name] = p.default
        elif p.required:
            sample[p.name] = (p.enum[0] if getattr(p, "enum", None) else _placeholder(p.type))

    try:
        url = spec.url.format(**sample)
    except Exception:  # noqa: BLE001
        url = spec.url
    remaining = {k: v for k, v in sample.items() if "{" + k + "}" not in spec.url}

    method = (spec.method or "GET").upper()
    if method == "GET":
        res = run_request(method, url, params=remaining, headers=spec.headers, timeout=spec.timeout)
    else:
        if spec.body_template:
            try:
                body = json.loads(spec.body_template.format(**sample))
            except Exception:  # noqa: BLE001
                body = spec.body_template.format(**sample)
        else:
            body = remaining
        res = run_request(method, url, json_body=body, headers=spec.headers, timeout=spec.timeout)
    out = res.to_dict()
    out["url"] = url
    return out

"""机会性上报使用埋点(发累计值,网站按 hid 覆盖→重发不双计;离线则积压)。"""
import json
import urllib.request

from .usage import read, telemetry_hid


def build_report(root) -> dict:
    return {"hid": telemetry_hid(root), "usage": read(root)}


def try_report(root, base_url: str, *, timeout: float = 5.0) -> dict:
    rep = build_report(root)
    if not rep["usage"]:
        return {"sent": False, "reason": "nothing"}
    try:
        data = json.dumps(rep).encode("utf-8")
        req = urllib.request.Request(f"{base_url.rstrip('/')}/api/usage-report", data=data,
                                     headers={"content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"sent": resp.status == 200}
    except Exception as e:
        return {"sent": False, "reason": str(e)}

"""机会性上报:机器联网时 best-effort 上传已核销促销卡 id。离线则积压。"""
import json
import urllib.request

from . import entstore
from .fingerprint import fingerprint as _fp


def build_report(root) -> dict:
    items = [{"id": r["id"], "at": r.get("at")}
             for r in entstore.read_redeemed_cards(root) if not r.get("reported")]
    return {"mid": _fp(root), "items": items}


def mark_reported(root, ids: list) -> None:
    entstore.mark_redeemed_cards_reported(root, ids)


def try_report(root, base_url: str, *, timeout: float = 5.0) -> dict:
    """best-effort:成功(HTTP 200)则标记已上报。任何异常吞掉(离线/超时)。"""
    rep = build_report(root)
    if not rep["items"]:
        return {"sent": False, "reason": "nothing"}
    try:
        data = json.dumps(rep).encode("utf-8")
        req = urllib.request.Request(f"{base_url.rstrip('/')}/api/card/report", data=data,
                                     headers={"content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                mark_reported(root, [it["id"] for it in rep["items"]])
                return {"sent": True, "count": len(rep["items"])}
            return {"sent": False, "reason": f"http-{resp.status}"}
    except Exception as e:
        return {"sent": False, "reason": str(e)}

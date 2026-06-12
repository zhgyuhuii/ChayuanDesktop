"""机会性上报使用埋点(发累计值,网站按 hid 覆盖→重发不双计;离线则积压)。"""
import json
import threading
import time
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


def start_report_loop(root, base_url: str, *, first_delay: float = 60.0,
                      interval: float = 1800.0) -> threading.Thread:
    """后台 daemon 线程:首次 first_delay 秒后上报,之后每 interval 秒一次。

    机会性上报——离线/DNS失败/超时/任何异常全部静默吞掉,绝不影响主程序;
    连不上 aidooo.com 也只是本轮不发,数据继续在本地积压,下轮重发(网站按 hid 覆盖不双计)。
    返回已启动的 daemon 线程(随主进程退出而终止)。
    """
    def _loop() -> None:
        time.sleep(first_delay)
        while True:
            try:
                try_report(root, base_url)
            except Exception:
                pass
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True, name="usage-report-loop")
    t.start()
    return t

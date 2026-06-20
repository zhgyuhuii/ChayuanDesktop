"""硬件性能指标采集(框架无关)。镜像 config_panel.performance_page.HardwareSnapshot。

psutil 装不上时返回零值降级,绝不 crash。React admin 性能页轮询消费。
"""
from __future__ import annotations

import os
import shutil
from typing import Any, Dict, List


def _psutil():
    try:
        import psutil  # type: ignore
        return psutil
    except Exception:
        return None


def _gpus() -> List[Dict[str, Any]]:
    try:
        import pynvml  # type: ignore
        pynvml.nvmlInit()
        out: List[Dict[str, Any]] = []
        for i in range(pynvml.nvmlDeviceGetCount()):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            try:
                temp = int(pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU))
            except Exception:
                temp = 0
            name = pynvml.nvmlDeviceGetName(h)
            out.append({
                "name": name.decode() if isinstance(name, bytes) else str(name),
                "util": int(util.gpu), "mem_total": int(mem.total),
                "mem_used": int(mem.used), "temp": temp,
            })
        pynvml.nvmlShutdown()
        return out
    except Exception:
        return []


def collect_hardware_snapshot() -> dict:
    ps = _psutil()
    snap: Dict[str, Any] = {
        "cpu_percent": 0.0, "cpu_per_core": [], "cpu_count_logical": os.cpu_count() or 1,
        "cpu_count_physical": os.cpu_count() or 1, "load_1": 0.0, "load_5": 0.0, "load_15": 0.0,
        "mem_total": 0, "mem_used": 0, "mem_available": 0, "mem_percent": 0.0,
        "swap_total": 0, "swap_used": 0, "disks": [], "gpus": _gpus(),
        "net_bytes_sent": 0, "net_bytes_recv": 0,
    }
    try:
        la = os.getloadavg()
        snap["load_1"], snap["load_5"], snap["load_15"] = float(la[0]), float(la[1]), float(la[2])
    except Exception:
        pass

    if ps is None:
        # 降级:至少给磁盘根
        try:
            t, u, f = shutil.disk_usage("/")
            snap["disks"] = [{"mount": "/", "total": t, "used": u, "free": f, "percent": round(u / t * 100, 1) if t else 0}]
        except Exception:
            pass
        return snap

    try:
        snap["cpu_percent"] = float(ps.cpu_percent(interval=0.1))
        snap["cpu_per_core"] = [float(x) for x in ps.cpu_percent(percpu=True)]
        snap["cpu_count_logical"] = ps.cpu_count(logical=True) or snap["cpu_count_logical"]
        snap["cpu_count_physical"] = ps.cpu_count(logical=False) or snap["cpu_count_physical"]
    except Exception:
        pass
    try:
        m = ps.virtual_memory()
        snap.update(mem_total=int(m.total), mem_used=int(m.used), mem_available=int(m.available), mem_percent=float(m.percent))
        sw = ps.swap_memory()
        snap.update(swap_total=int(sw.total), swap_used=int(sw.used))
    except Exception:
        pass
    try:
        seen = set()
        for part in ps.disk_partitions(all=False):
            mp = part.mountpoint
            if mp in seen:
                continue
            seen.add(mp)
            try:
                u = ps.disk_usage(mp)
                snap["disks"].append({"mount": mp, "total": int(u.total), "used": int(u.used), "free": int(u.free), "percent": float(u.percent)})
            except Exception:
                continue
    except Exception:
        pass
    try:
        n = ps.net_io_counters()
        snap.update(net_bytes_sent=int(n.bytes_sent), net_bytes_recv=int(n.bytes_recv))
    except Exception:
        pass
    return snap

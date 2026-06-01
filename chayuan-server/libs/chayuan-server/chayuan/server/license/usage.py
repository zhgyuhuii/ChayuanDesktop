"""使用埋点(匿名计数):每模块×来源(free/count/time)+ 撞上限(blocked)。只计数,无内容、无逐次时间戳。"""
import json
import hashlib
from pathlib import Path

from .fingerprint import _stable_machine_id

_OUTCOMES = ("free", "count", "time", "blocked")


def _path(root) -> Path:
    return Path(root) / "license" / "usage.json"


def read(root) -> dict:
    try:
        return json.loads(_path(root).read_text(encoding="utf-8"))
    except Exception:
        return {}


def record(root, module: str, outcome: str) -> None:
    if outcome not in _OUTCOMES or not module:
        return
    data = read(root)
    m = data.setdefault(module, {})
    m[outcome] = int(m.get(outcome, 0)) + 1   # 单调累加,不清零
    p = _path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(p)


def telemetry_hid(root) -> str:
    # 与授权指纹解耦的匿名 id(纯哈希,无法反推机器/文档)。
    return hashlib.sha256(("usage:" + _stable_machine_id(Path(root))).encode()).hexdigest()[:16]

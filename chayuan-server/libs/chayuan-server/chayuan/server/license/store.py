"""防回拨激活记录:chayuan_root/license/<app>.json。tmp+rename 原子写。"""
import json
from pathlib import Path


def _path(root: Path, app: str) -> Path:
    return root / "license" / f"{app}.json"


def read_activation(root: Path, app: str):
    p = _path(root, app)
    try:
        return json.loads(p.read_text())
    except FileNotFoundError:
        return None
    except Exception:
        return None


def write_activation(root: Path, rec: dict) -> None:
    p = _path(root, rec["app"])
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec))
    tmp.replace(p)

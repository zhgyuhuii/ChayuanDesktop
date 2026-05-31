"""权益状态:每模块 license/entitlements/<app>.json + 全局已核销码 license/redeemed.json。tmp+rename 原子写。"""
import json
from pathlib import Path


def _ent_dir(root: Path) -> Path:
    return Path(root) / "license" / "entitlements"


def state_path(root: Path, app: str) -> Path:
    return _ent_dir(root) / f"{app}.json"


def default_state(app: str) -> dict:
    return {"app": app, "timeExpireAt": None, "counts": 0, "countExpireAt": None,
            "freeUsedToday": 0, "freeDate": None, "seenMax": 0}


def read_state(root: Path, app: str) -> dict:
    p = state_path(root, app)
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        base = default_state(app)
        base.update({k: d[k] for k in base if k in d})
        return base
    except Exception:
        return default_state(app)


def write_state(root: Path, state: dict) -> None:
    p = state_path(root, state["app"])
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    tmp.replace(p)


def _redeemed_path(root: Path) -> Path:
    return Path(root) / "license" / "redeemed.json"


def read_redeemed(root: Path) -> set:
    try:
        return set(json.loads(_redeemed_path(root).read_text(encoding="utf-8")))
    except Exception:
        return set()


def is_redeemed(root: Path, code_id: str) -> bool:
    return code_id in read_redeemed(root)


def add_redeemed(root: Path, code_id: str) -> None:
    ids = read_redeemed(root)
    ids.add(code_id)
    p = _redeemed_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(ids)), encoding="utf-8")
    tmp.replace(p)


def _redeemed_cards_path(root: Path) -> Path:
    return Path(root) / "license" / "redeemed_cards.json"


def read_redeemed_cards(root: Path) -> list:
    try:
        return json.loads(_redeemed_cards_path(root).read_text(encoding="utf-8"))
    except Exception:
        return []


def add_redeemed_card(root: Path, rec: dict) -> None:
    recs = read_redeemed_cards(root)
    recs.append(rec)
    p = _redeemed_cards_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(recs), encoding="utf-8")
    tmp.replace(p)


def mark_redeemed_cards_reported(root: Path, ids: list) -> None:
    recs = read_redeemed_cards(root)
    idset = set(ids)
    for r in recs:
        if r.get("id") in idset:
            r["reported"] = True
    p = _redeemed_cards_path(root)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(recs), encoding="utf-8")
    tmp.replace(p)

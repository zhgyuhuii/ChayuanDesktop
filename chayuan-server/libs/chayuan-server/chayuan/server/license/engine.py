"""权益状态机:status / consume / redeem / redeem_shortcode。
三级放行:时间制(不限次)→ 每日免费 → 购买次数。每日清零 + 防回拨 + 防重放。"""
from datetime import datetime, timezone

from . import entstore, entcode
from .shortcode import verify_shortcode
from .fingerprint import fingerprint as _fp

ROLLBACK_TOLERANCE = 86400  # 1 天(秒)


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def _to_iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{int((epoch % 1) * 1000):03d}Z"


def _today(now: float) -> str:
    return datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")


def _normalize(state: dict, now: float) -> dict:
    """跨天清零免费计数。"""
    today = _today(now)
    if state.get("freeDate") != today:
        state["freeUsedToday"] = 0
        state["freeDate"] = today
    return state


def _time_valid(state: dict, now: float) -> bool:
    exp = state.get("timeExpireAt")
    return bool(exp) and now < _ts(exp)


def _rolled_back(state: dict, now: float) -> bool:
    return now < state.get("seenMax", 0) - ROLLBACK_TOLERANCE


def status(root, app: str, cfg: dict, *, now=None) -> dict:
    now = _now() if now is None else now
    # 免费模块:整模块不门控、不限次,直接可用(不读/不写状态)。
    if app in set(cfg.get("free_modules", [])):
        return {"app": app, "free": True, "licensed": True,
                "timeExpireAt": None, "counts": 0, "dailyFree": 0, "remainingFree": 0}
    state = _normalize(entstore.read_state(root, app), now)
    daily = int(cfg.get("daily_free", {}).get(app, 0))
    remaining_free = max(0, daily - state["freeUsedToday"])
    base = {
        "app": app, "free": False, "timeExpireAt": state["timeExpireAt"], "counts": state["counts"],
        "dailyFree": daily, "remainingFree": remaining_free,
    }
    if _rolled_back(state, now):
        return {**base, "licensed": False, "reason": "rollback"}
    licensed = _time_valid(state, now) or remaining_free > 0 or state["counts"] > 0
    return {**base, "licensed": licensed}


def consume(root, app: str, cfg: dict, *, now=None) -> dict:
    now = _now() if now is None else now
    # 免费模块:无条件放行,不扣不记。
    if app in set(cfg.get("free_modules", [])):
        return {"allowed": True, "source": "free", "remainingFree": 0,
                "counts": 0, "timeExpireAt": None, "free": True}
    state = _normalize(entstore.read_state(root, app), now)
    daily = int(cfg.get("daily_free", {}).get(app, 0))

    if _rolled_back(state, now):
        return {"allowed": False, "source": "none", "reason": "rollback",
                "remainingFree": 0, "counts": state["counts"], "timeExpireAt": state["timeExpireAt"]}

    # 单调推进 seenMax(防回拨基线)
    if now > state.get("seenMax", 0):
        state["seenMax"] = now

    def _ret(source):
        entstore.write_state(root, state)
        return {"allowed": True, "source": source,
                "remainingFree": max(0, daily - state["freeUsedToday"]),
                "counts": state["counts"], "timeExpireAt": state["timeExpireAt"]}

    # 1) 时间制有效 → 不限次,不扣
    if _time_valid(state, now):
        return _ret("time")
    # 2) 每日免费
    if state["freeUsedToday"] < daily:
        state["freeUsedToday"] += 1
        return _ret("free")
    # 3) 购买次数
    if state["counts"] > 0:
        state["counts"] -= 1
        return _ret("count")
    # 都没了
    entstore.write_state(root, state)  # 落 seenMax
    return {"allowed": False, "source": "none", "remainingFree": 0,
            "counts": state["counts"], "timeExpireAt": state["timeExpireAt"]}

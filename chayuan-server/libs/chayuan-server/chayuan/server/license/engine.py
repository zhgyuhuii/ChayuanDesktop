"""权益状态机:status / consume / redeem / redeem_shortcode。
三级放行:时间制(不限次)→ 每日免费 → 购买次数。每日清零 + 防回拨 + 防重放。"""
import hashlib
from datetime import datetime, timezone

from . import entstore, entcode, usage
from .shortcode import verify_shortcode
from .fingerprint import fingerprint as _fp, candidate_fingerprints

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


def _count_expired(state: dict, now: float) -> bool:
    ce = state.get("countExpireAt")
    return bool(ce) and now >= _ts(ce)


def _rec(root, app: str, outcome: str, cfg: dict) -> None:
    """埋点:默认开,cfg.telemetry_enabled=False 关。写失败不影响放行。"""
    if not cfg.get("telemetry_enabled", True):
        return
    try:
        usage.record(root, app, outcome)
    except Exception:
        pass


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
    has_count = state["counts"] > 0 and not _count_expired(state, now)
    licensed = _time_valid(state, now) or remaining_free > 0 or has_count
    return {**base, "licensed": licensed}


def consume(root, app: str, cfg: dict, *, now=None) -> dict:
    now = _now() if now is None else now
    # 免费模块:无条件放行,不扣不记。
    if app in set(cfg.get("free_modules", [])):
        _rec(root, app, "free", cfg)
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
        _rec(root, app, source, cfg)
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
    # 3) 购买/赠送次数(带使用到期)
    if state["counts"] > 0 and not _count_expired(state, now):
        state["counts"] -= 1
        return _ret("count")
    # 都没了
    entstore.write_state(root, state)  # 落 seenMax
    _rec(root, app, "blocked", cfg)
    return {"allowed": False, "source": "none", "remainingFree": 0,
            "counts": state["counts"], "timeExpireAt": state["timeExpireAt"]}


def _code_id_of(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]


def _apply_grant(root, grant: dict, now: float) -> None:
    app = grant["app"]
    state = _normalize(entstore.read_state(root, app), now)
    kind = grant["kind"]
    if kind == "count":
        state["counts"] += int(grant["n"])
        if grant.get("until") is not None:
            cur = _ts(state["countExpireAt"]) if state.get("countExpireAt") else 0
            state["countExpireAt"] = _to_iso(max(cur, float(grant["until"])))
    elif kind == "time":
        cur = _ts(state["timeExpireAt"]) if state["timeExpireAt"] else 0
        if "days" in grant:
            base = max(now, cur)
            new_exp = base + int(grant["days"]) * 86400
        else:  # until(绝对到期,旧 .lic 令牌)
            new_exp = max(cur, float(grant["until"]))
        state["timeExpireAt"] = _to_iso(new_exp)
    if now > state.get("seenMax", 0):
        state["seenMax"] = now
    entstore.write_state(root, state)


def redeem(root, code: str, cfg: dict, *, now=None) -> dict:
    now = _now() if now is None else now
    r = entcode.verify(code, cfg.get("public_key", b""))
    if not r.get("valid"):
        return {"ok": False, "reason": "signature"}
    p = r["payload"]

    # 归一化:新码用 grants;旧 .lic 单模块令牌({app,exp})合成单个 time grant。
    if isinstance(p.get("grants"), list):
        grants, code_id, mid, card_exp = p["grants"], p.get("id"), p.get("mid"), p.get("cardExpireAt")
        src = p.get("src")
    elif "app" in p and "exp" in p:
        grants = [{"app": p["app"], "kind": "time", "until": p["exp"]}]
        code_id, mid, card_exp = p.get("oid") or _code_id_of(code), p.get("mid"), None
        src = p.get("src")
    else:
        return {"ok": False, "reason": "shape"}

    shape_err = entcode.validate_payload({"grants": grants})
    if shape_err:
        return {"ok": False, "reason": shape_err}
    if card_exp and now > _ts(card_exp):
        return {"ok": False, "reason": "card-expired"}
    if mid and mid.lower() not in candidate_fingerprints(root):
        return {"ok": False, "reason": "mismatch"}
    if not code_id:
        return {"ok": False, "reason": "no-id"}
    code_id = str(code_id)  # 防签发端给非字符串 id 导致 add_redeemed 的 sorted() 崩
    if entstore.is_redeemed(root, code_id):
        return {"ok": False, "reason": "used"}

    # 先记 id 再入账:多 grant 中途若写盘失败,该码已被标记消耗,不会被重复核销
    # (宁可这张码作废,也不允许部分应用后重复刷次数)。
    entstore.add_redeemed(root, code_id)
    for g in grants:
        _apply_grant(root, g, now)
    if src == "promo":
        entstore.add_redeemed_card(root, {"id": str(code_id), "mid": _fp(root), "at": _to_iso(now)})
    return {"ok": True, "applied": grants}


def redeem_shortcode(root, serial: str, cfg: dict, *, now=None) -> dict:
    """位图短码:HMAC 验签(绑本机指纹)→ 按 modules 位图展开到各模块。
    kind=0 时长:逐模块 max 到期(幂等不去重);kind=1 次数:去重后逐模块累加 counts。"""
    now = _now() if now is None else now
    r = {"valid": False, "reason": "signature"}
    for fp_hex in candidate_fingerprints(root):
        rr = verify_shortcode(serial, bytes.fromhex(fp_hex), cfg.get("hmac_keys", {}))
        if rr.get("valid"):
            r = rr
            break
        r = rr  # 记最后一次失败原因
    if not r.get("valid"):
        return {"ok": False, "reason": r.get("reason") or "signature"}
    fields = r["fields"]
    products = cfg.get("products", {})
    mods = [name for name, bit in products.items() if fields["modules"] & (1 << int(bit))]
    if not mods:
        return {"ok": False, "reason": "no-module"}

    if fields["kind"] == 1:  # 次数:去重后逐模块累加
        code_id = hashlib.sha256(serial.encode("utf-8")).hexdigest()[:16]
        if entstore.is_redeemed(root, code_id):
            return {"ok": False, "reason": "used"}
        entstore.add_redeemed(root, code_id)
        exp = r.get("expireAt")
        for m in mods:
            state = _normalize(entstore.read_state(root, m), now)
            state["counts"] += int(fields["value"])
            if exp:
                cur = _ts(state["countExpireAt"]) if state.get("countExpireAt") else 0
                state["countExpireAt"] = _to_iso(max(cur, _ts(exp)))
            if now > state.get("seenMax", 0):
                state["seenMax"] = now
            entstore.write_state(root, state)
        return {"ok": True, "kind": "count", "modules": mods, "added": int(fields["value"])}

    # kind=0 时长:逐模块取 max 到期
    exp = r["expireAt"]
    applied = []
    for m in mods:
        state = _normalize(entstore.read_state(root, m), now)
        cur = _ts(state["timeExpireAt"]) if state["timeExpireAt"] else 0
        if _ts(exp) > cur:
            state["timeExpireAt"] = exp
        if now > state.get("seenMax", 0):
            state["seenMax"] = now
        entstore.write_state(root, state)
        applied.append({"app": m, "timeExpireAt": state["timeExpireAt"]})
    return {"ok": True, "kind": "time", "modules": mods, "applied": applied}

# Plan A — 权益引擎 + 状态机(chayuan-server)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chayuan-server 里建立"按机器 × 按模块"的权益状态机:三级放行判定(时间制不限次 → 每日免费 → 购买次数)、统一权益码(Ed25519)多 grant 核销、旧 25 位短码/旧 .lic 令牌兼容、每日清零、防回拨、防重放(一码一机一次)、并发锁,并暴露 `/consume /redeem /status /entitlements` API。

**Architecture:** 新增三个纯逻辑模块 `entstore`(状态文件)、`entcode`(统一权益码验签)、`engine`(状态机:status/consume/redeem),复用既有 `token.verify_token`(Ed25519)、`shortcode.verify_shortcode`(B1 HMAC)、`fingerprint`、`service._now/_ts`。路由层加全局 `asyncio.Lock` 串行化所有变更操作。统一权益码 = `base64url(canonicalJSON).base64url(ed25519sig)`,canonicalJSON = `sort_keys + 紧凑分隔符`,与 website 签发端字节兼容(黄金向量用固定测试私钥锁定格式)。

**Tech Stack:** Python 3.12、FastAPI、`cryptography`(Ed25519)、pytest、标准库 `hmac/hashlib/json/base64`。

包根:`/work/chayuan-desktop/chayuan-server/libs/chayuan-server`。后文相对路径均相对此根。运行测试统一前缀 `PYTHONPATH=. python3 -m pytest`。

---

## 文件结构

**新建:**
- `chayuan/server/license/entstore.py` — 权益状态读写:每模块状态 `license/entitlements/<app>.json` + 全局已核销码集合 `license/redeemed.json`,原子写。
- `chayuan/server/license/entcode.py` — 统一权益码验签:`verify(code, public_key)`(复用 `token.verify_token`)+ payload 形状校验。
- `chayuan/server/license/engine.py` — 状态机:`status / consume / redeem / redeem_shortcode`,三级判定、每日清零、防回拨、防重放、多 grant 入账、时间叠加/次数累加。
- 测试:`tests/server/license/test_entstore.py`、`test_entcode.py`、`test_engine.py`、`test_engine_redeem.py`、`test_routes_entitlement.py`。
- 测试辅助:`tests/server/license/_entcode_sign.py` — 测试用签发器(固定测试 Ed25519 私钥),锁定 canonical 格式 + 产黄金向量。

**修改:**
- `chayuan/server/license/config.py` — `load_license_config` 增 `daily_free`(map app→int)。
- `chayuan/server/api_server/license_routes.py` — 新增 `POST /consume`、`POST /redeem`;改写 `GET /status`(走 engine,向后兼容旧字段)、`GET /entitlements`(走 engine 状态);加全局 `asyncio.Lock`;`POST /activate`(25 位短码)改走 `engine.redeem_shortcode`;`POST /activate-token` 改走 `engine.redeem`。

**约定的数据形状(全程一致):**

权益状态 `entstore` 单模块:
```json
{ "app": "video", "timeExpireAt": null, "counts": 0,
  "freeUsedToday": 0, "freeDate": null, "seenMax": 0 }
```
> 防重放的"已核销码 id"是**机器全局**的(一码可给多模块,只能整体核销一次),单独存 `license/redeemed.json`(id 列表),不放进单模块状态。

统一权益码 payload(canonical JSON,sort_keys + `(",",":")`):
```json
{ "v":1, "id":"<hex>", "src":"purchase|promo|share|gift",
  "mid":"<fp>"|null, "cardExpireAt":"2026-12-31T00:00:00.000Z"|null,
  "grants":[ {"app":"video","kind":"time","days":30},
             {"app":"chat","kind":"count","n":100} ] }
```
- 时间 grant:`{"app","kind":"time","days":N}`(从 max(now,现有到期) 叠加 N 天)或 `{"app","kind":"time","until":<epoch秒>}`(取 max(现有, until),用于旧 .lic 令牌兼容)。
- 次数 grant:`{"app","kind":"count","n":N}`(累加)。

`consume` 返回:`{"allowed":bool,"source":"time|free|count|none","remainingFree":int,"counts":int,"timeExpireAt":str|null,"reason":str?}`。
`redeem` 返回:`{"ok":bool,"reason":str?,"applied":[{"app","kind","..."}]?}`。

---

### Task 1: `entstore.py` 权益状态读写

**Files:**
- Create: `chayuan/server/license/entstore.py`
- Test: `tests/server/license/test_entstore.py`

- [ ] **Step 1: 写失败测试**

Create `tests/server/license/test_entstore.py`:

```python
from chayuan.server.license import entstore


def test_default_state_when_missing(tmp_path):
    s = entstore.read_state(tmp_path, "video")
    assert s == {"app": "video", "timeExpireAt": None, "counts": 0,
                 "freeUsedToday": 0, "freeDate": None, "seenMax": 0}


def test_write_then_read_roundtrip(tmp_path):
    s = entstore.read_state(tmp_path, "video")
    s["counts"] = 5
    s["timeExpireAt"] = "2026-07-01T00:00:00.000Z"
    entstore.write_state(tmp_path, s)
    again = entstore.read_state(tmp_path, "video")
    assert again["counts"] == 5
    assert again["timeExpireAt"] == "2026-07-01T00:00:00.000Z"


def test_corrupt_file_falls_back_to_default(tmp_path):
    p = entstore.state_path(tmp_path, "video")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{ not json", encoding="utf-8")
    assert entstore.read_state(tmp_path, "video")["counts"] == 0


def test_redeemed_set_add_and_check(tmp_path):
    assert entstore.read_redeemed(tmp_path) == set()
    assert entstore.is_redeemed(tmp_path, "abc") is False
    entstore.add_redeemed(tmp_path, "abc")
    assert entstore.is_redeemed(tmp_path, "abc") is True
    assert "abc" in entstore.read_redeemed(tmp_path)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_entstore.py -q`
Expected: FAIL — `ModuleNotFoundError: chayuan.server.license.entstore`。

- [ ] **Step 3: 实现 `entstore.py`**

```python
"""权益状态:每模块 license/entitlements/<app>.json + 全局已核销码 license/redeemed.json。tmp+rename 原子写。"""
import json
from pathlib import Path


def _ent_dir(root: Path) -> Path:
    return Path(root) / "license" / "entitlements"


def state_path(root: Path, app: str) -> Path:
    return _ent_dir(root) / f"{app}.json"


def default_state(app: str) -> dict:
    return {"app": app, "timeExpireAt": None, "counts": 0,
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_entstore.py -q`
Expected: PASS（4 passed）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/entstore.py chayuan-server/libs/chayuan-server/tests/server/license/test_entstore.py
git commit -m "feat(license): entstore 权益状态读写 + 全局已核销码集合"
```

---

### Task 2: `entcode.py` 统一权益码验签 + 黄金向量

**Files:**
- Create: `tests/server/license/_entcode_sign.py`（测试用签发器,锁 canonical 格式）
- Create: `chayuan/server/license/entcode.py`
- Test: `tests/server/license/test_entcode.py`

- [ ] **Step 1: 写测试用签发器**

Create `tests/server/license/_entcode_sign.py`:

```python
"""测试用统一权益码签发器(固定测试 Ed25519 私钥)。
canonical = json.dumps(payload, sort_keys=True, separators=(",",":"))。
website 签发端(Plan B)必须产出字节一致的码。"""
import json
import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

# 固定测试私钥种子(32 字节 = 00 01 02 ... 1f),仅测试用。
SEED_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def public_key_bytes() -> bytes:
    sk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(SEED_HEX))
    return sk.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def sign_entcode(payload: dict) -> str:
    sk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(SEED_HEX))
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sig = sk.sign(msg)
    return _b64u(msg) + "." + _b64u(sig)
```

- [ ] **Step 2: 写失败测试**

Create `tests/server/license/test_entcode.py`:

```python
from chayuan.server.license import entcode
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

PAYLOAD = {
    "v": 1, "id": "deadbeefdeadbeef", "src": "promo", "mid": None,
    "cardExpireAt": "2026-12-31T00:00:00.000Z",
    "grants": [{"app": "video", "kind": "time", "days": 30},
               {"app": "chat", "kind": "count", "n": 100}],
}


def test_verify_valid_code_returns_payload():
    code = sign_entcode(PAYLOAD)
    r = entcode.verify(code, public_key_bytes())
    assert r["valid"] is True
    assert r["payload"]["id"] == "deadbeefdeadbeef"
    assert r["payload"]["grants"][1]["n"] == 100


def test_tampered_code_rejected():
    code = sign_entcode(PAYLOAD)
    bad = code[:-2] + ("AA" if not code.endswith("AA") else "BB")
    assert entcode.verify(bad, public_key_bytes())["valid"] is False


def test_wrong_key_rejected():
    code = sign_entcode(PAYLOAD)
    assert entcode.verify(code, b"\x00" * 32)["valid"] is False


def test_validate_payload_shape():
    assert entcode.validate_payload(PAYLOAD) is None
    assert entcode.validate_payload({"grants": "nope"}) == "shape"
    assert entcode.validate_payload({"grants": [{"app": "x", "kind": "weird"}]}) == "grant-kind"
    assert entcode.validate_payload({"grants": [{"kind": "count", "n": 1}]}) == "grant-app"
```

- [ ] **Step 3: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_entcode.py -q`
Expected: FAIL — `ModuleNotFoundError: chayuan.server.license.entcode`。

- [ ] **Step 4: 实现 `entcode.py`**

```python
"""统一权益码:base64url(canonicalJSON).base64url(ed25519sig)。复用 token.verify_token(仅公钥)。"""
from .token import verify_token

_VALID_APP = set("abcdefghijklmnopqrstuvwxyz0123456789_-")


def verify(code: str, public_key: bytes) -> dict:
    """验签;成功返回 {valid:True, payload}。"""
    return verify_token(code, public_key)


def validate_payload(p: dict) -> str | None:
    """形状校验;合法返回 None,否则返回原因字符串。"""
    if not isinstance(p, dict):
        return "shape"
    grants = p.get("grants")
    if not isinstance(grants, list) or not grants:
        return "shape"
    for g in grants:
        if not isinstance(g, dict):
            return "shape"
        app = g.get("app")
        if not isinstance(app, str) or not app or any(c not in _VALID_APP for c in app):
            return "grant-app"
        kind = g.get("kind")
        if kind == "time":
            if not (isinstance(g.get("days"), int) or isinstance(g.get("until"), (int, float))):
                return "grant-value"
        elif kind == "count":
            if not isinstance(g.get("n"), int) or g["n"] <= 0:
                return "grant-value"
        else:
            return "grant-kind"
    return None
```

- [ ] **Step 5: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_entcode.py -q`
Expected: PASS（4 passed）。

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/entcode.py \
        chayuan-server/libs/chayuan-server/tests/server/license/test_entcode.py \
        chayuan-server/libs/chayuan-server/tests/server/license/_entcode_sign.py
git commit -m "feat(license): entcode 统一权益码 Ed25519 验签 + 形状校验 + 测试签发器"
```

---

### Task 3: `engine.status` — 三级判定只读视图 + 每日清零 + 防回拨

**Files:**
- Create: `chayuan/server/license/engine.py`
- Test: `tests/server/license/test_engine.py`

- [ ] **Step 1: 写失败测试**

Create `tests/server/license/test_engine.py`:

```python
from chayuan.server.license import engine, entstore

CFG = {"daily_free": {"video": 2, "chat": 10}, "public_key": b"", "hmac_keys": {}}
T0 = 1780000000.0  # 固定 now(UTC epoch 秒),约 2026-05


def test_status_unlicensed_shows_free_quota(tmp_path):
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["dailyFree"] == 2
    assert s["remainingFree"] == 2
    assert s["counts"] == 0
    assert s["timeExpireAt"] is None
    assert s["licensed"] is True  # 有免费额度也算"可用"


def test_status_time_licensed(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["timeExpireAt"] = "2099-01-01T00:00:00.000Z"
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["licensed"] is True
    assert s["timeExpireAt"] == "2099-01-01T00:00:00.000Z"


def test_status_no_free_no_count_not_licensed(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["freeUsedToday"] = 2
    st["freeDate"] = engine._today(T0)
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["remainingFree"] == 0
    assert s["licensed"] is False


def test_status_daily_reset_across_midnight(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["freeUsedToday"] = 2
    st["freeDate"] = "2020-01-01"  # 旧日期
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["remainingFree"] == 2  # 跨天清零


def test_status_rollback_flagged(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["timeExpireAt"] = "2099-01-01T00:00:00.000Z"
    st["seenMax"] = T0 + 10 * 86400  # 见过的最大时间远在未来
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["licensed"] is False
    assert s["reason"] == "rollback"


def test_free_module_always_licensed(tmp_path):
    cfg = {"daily_free": {}, "free_modules": ["kb"], "public_key": b"", "hmac_keys": {}}
    s = engine.status(tmp_path, "kb", cfg, now=T0)
    assert s["free"] is True and s["licensed"] is True
    r = engine.consume(tmp_path, "kb", cfg, now=T0)
    assert r["allowed"] is True and r["source"] == "free"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine.py -q`
Expected: FAIL — `ModuleNotFoundError: chayuan.server.license.engine`。

- [ ] **Step 3: 实现 `engine.py`(status 部分)**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine.py -q`
Expected: PASS（5 passed）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/engine.py chayuan-server/libs/chayuan-server/tests/server/license/test_engine.py
git commit -m "feat(license): engine.status 三级可用判定 + 每日清零 + 防回拨"
```

---

### Task 4: `engine.consume` — 三级扣减

**Files:**
- Modify: `chayuan/server/license/engine.py`
- Test: `tests/server/license/test_engine.py`（追加）

- [ ] **Step 1: 追加失败测试**

Append to `tests/server/license/test_engine.py`:

```python
def test_consume_time_licensed_does_not_deduct(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["timeExpireAt"] = "2099-01-01T00:00:00.000Z"
    st["counts"] = 5
    entstore.write_state(tmp_path, st)
    r = engine.consume(tmp_path, "video", CFG, now=T0)
    assert r["allowed"] is True and r["source"] == "time"
    assert entstore.read_state(tmp_path, "video")["counts"] == 5  # 不扣次数


def test_consume_uses_free_then_count(tmp_path):
    # 2 次免费用完,再用扣次数
    for i in range(2):
        r = engine.consume(tmp_path, "video", CFG, now=T0)
        assert r["allowed"] is True and r["source"] == "free"
    st = entstore.read_state(tmp_path, "video")
    st["counts"] = 1
    entstore.write_state(tmp_path, st)
    r = engine.consume(tmp_path, "video", CFG, now=T0)
    assert r["allowed"] is True and r["source"] == "count"
    assert entstore.read_state(tmp_path, "video")["counts"] == 0


def test_consume_blocked_when_exhausted(tmp_path):
    for _ in range(2):
        engine.consume(tmp_path, "video", CFG, now=T0)  # 用完免费
    r = engine.consume(tmp_path, "video", CFG, now=T0)
    assert r["allowed"] is False and r["source"] == "none"


def test_consume_rollback_blocked(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["seenMax"] = T0 + 10 * 86400
    entstore.write_state(tmp_path, st)
    r = engine.consume(tmp_path, "video", CFG, now=T0)
    assert r["allowed"] is False and r["reason"] == "rollback"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine.py -k consume -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'consume'`。

- [ ] **Step 3: 在 `engine.py` 追加 `consume`**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine.py -q`
Expected: PASS（9 passed）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/engine.py chayuan-server/libs/chayuan-server/tests/server/license/test_engine.py
git commit -m "feat(license): engine.consume 三级扣减(时间/免费/次数)"
```

---

### Task 5: `engine.redeem` — 统一权益码多 grant 核销 + 防重放 + 叠加

**Files:**
- Modify: `chayuan/server/license/engine.py`
- Test: `tests/server/license/test_engine_redeem.py`

- [ ] **Step 1: 写失败测试**

Create `tests/server/license/test_engine_redeem.py`:

```python
from chayuan.server.license import engine, entstore
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

T0 = 1780000000.0


def _cfg():
    return {"daily_free": {"video": 2, "chat": 10}, "public_key": public_key_bytes(), "hmac_keys": {}}


def _code(grants, code_id="id0001", mid=None, card_exp=None):
    return sign_entcode({"v": 1, "id": code_id, "src": "promo", "mid": mid,
                         "cardExpireAt": card_exp, "grants": grants})


def test_redeem_multi_grant_applies_count_and_time(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5},
                  {"app": "chat", "kind": "time", "days": 30}])
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is True
    assert entstore.read_state(tmp_path, "video")["counts"] == 5
    chat = entstore.read_state(tmp_path, "chat")
    assert chat["timeExpireAt"] is not None
    assert engine._ts(chat["timeExpireAt"]) > T0


def test_redeem_count_accumulates(tmp_path):
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "count", "n": 5}], code_id="a"), _cfg(), now=T0)
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "count", "n": 3}], code_id="b"), _cfg(), now=T0)
    assert entstore.read_state(tmp_path, "video")["counts"] == 8


def test_redeem_time_stacks_on_existing(tmp_path):
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "time", "days": 10}], code_id="a"), _cfg(), now=T0)
    exp1 = engine._ts(entstore.read_state(tmp_path, "video")["timeExpireAt"])
    engine.redeem(tmp_path, _code([{"app": "video", "kind": "time", "days": 10}], code_id="b"), _cfg(), now=T0)
    exp2 = engine._ts(entstore.read_state(tmp_path, "video")["timeExpireAt"])
    assert round(exp2 - exp1) == 10 * 86400  # 叠加 10 天


def test_redeem_same_code_twice_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}], code_id="dup")
    assert engine.redeem(tmp_path, code, _cfg(), now=T0)["ok"] is True
    r2 = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r2["ok"] is False and r2["reason"] == "used"
    assert entstore.read_state(tmp_path, "video")["counts"] == 5  # 不重复加


def test_redeem_card_expired_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}], card_exp="2020-01-01T00:00:00.000Z")
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "card-expired"


def test_redeem_bad_signature_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}])
    r = engine.redeem(tmp_path, code[:-2] + "ZZ", _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "signature"


def test_redeem_mid_mismatch_rejected(tmp_path):
    code = _code([{"app": "video", "kind": "count", "n": 5}], mid="ffffffffffffffff")
    r = engine.redeem(tmp_path, code, _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "mismatch"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine_redeem.py -q`
Expected: FAIL — `AttributeError: ... 'redeem'`。

- [ ] **Step 3: 在 `engine.py` 追加 `redeem`**

```python
def _apply_grant(root, grant: dict, now: float) -> None:
    app = grant["app"]
    state = _normalize(entstore.read_state(root, app), now)
    kind = grant["kind"]
    if kind == "count":
        state["counts"] += int(grant["n"])
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
    elif "app" in p and "exp" in p:
        grants = [{"app": p["app"], "kind": "time", "until": p["exp"]}]
        code_id, mid, card_exp = p.get("oid") or _code_id_of(code), p.get("mid"), None
    else:
        return {"ok": False, "reason": "shape"}

    shape_err = entcode.validate_payload({"grants": grants})
    if shape_err:
        return {"ok": False, "reason": shape_err}
    if card_exp and now > _ts(card_exp):
        return {"ok": False, "reason": "card-expired"}
    if mid and mid.lower() != _fp(root).lower():
        return {"ok": False, "reason": "mismatch"}
    if not code_id:
        return {"ok": False, "reason": "no-id"}
    if entstore.is_redeemed(root, code_id):
        return {"ok": False, "reason": "used"}

    for g in grants:
        _apply_grant(root, g, now)
    entstore.add_redeemed(root, code_id)
    return {"ok": True, "applied": grants}
```

并在 `engine.py` 顶部 import 区下方加 `_code_id_of`(旧令牌无 id 时用码串哈希当 id):

```python
import hashlib


def _code_id_of(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine_redeem.py -q`
Expected: PASS（7 passed）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/engine.py chayuan-server/libs/chayuan-server/tests/server/license/test_engine_redeem.py
git commit -m "feat(license): engine.redeem 统一权益码多 grant 核销(防重放/卡过期/绑机/叠加)"
```

---

### Task 6: `engine.redeem_shortcode` — 25 位短码兼容(时间 grant 入 entstore)

**Files:**
- Modify: `chayuan/server/license/engine.py`
- Test: `tests/server/license/test_engine_redeem.py`（追加）

> 复用既有 `shortcode.verify_shortcode(serial, machine_fp, hmac_keys) -> {valid, reason, fields, expireAt}`(返回 ISO 到期)。把它的到期写进 entstore.timeExpireAt(取 max,不超发)。

- [ ] **Step 1: 追加失败测试**

Append to `tests/server/license/test_engine_redeem.py`:

```python
import hmac as _hmac
import hashlib as _hashlib


def test_redeem_shortcode_sets_time(monkeypatch, tmp_path):
    # 用 stub 的 verify_shortcode 返回到期,验证 engine 把它写进 entstore。
    from chayuan.server.license import engine as eng

    def fake_verify(serial, machine_fp, hmac_keys):
        return {"valid": True, "reason": None, "fields": {"app": 1}, "expireAt": "2099-01-01T00:00:00.000Z"}

    monkeypatch.setattr(eng, "verify_shortcode", fake_verify)
    r = eng.redeem_shortcode(tmp_path, "2101W-0JWN1-MN2JP-9V4QW-MSGJ", "video", _cfg(), now=T0)
    assert r["ok"] is True
    assert entstore.read_state(tmp_path, "video")["timeExpireAt"] == "2099-01-01T00:00:00.000Z"


def test_redeem_shortcode_invalid_rejected(monkeypatch, tmp_path):
    from chayuan.server.license import engine as eng
    monkeypatch.setattr(eng, "verify_shortcode", lambda *a, **k: {"valid": False, "reason": "checksum"})
    r = eng.redeem_shortcode(tmp_path, "BAD", "video", _cfg(), now=T0)
    assert r["ok"] is False and r["reason"] == "checksum"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine_redeem.py -k shortcode -q`
Expected: FAIL — `AttributeError: ... 'redeem_shortcode'`。

- [ ] **Step 3: 在 `engine.py` 追加 `redeem_shortcode`**

```python
def redeem_shortcode(root, serial: str, app: str, cfg: dict, *, now=None) -> dict:
    """25 位 B1 短码:HMAC 验签(绑本机指纹)→ 时间写进 entstore(取 max)。"""
    now = _now() if now is None else now
    fp = _fp(root)
    fp_bytes = bytes.fromhex(fp)
    r = verify_shortcode(serial, fp_bytes, cfg.get("hmac_keys", {}))
    if not r.get("valid"):
        return {"ok": False, "reason": r.get("reason") or "signature"}
    exp = r["expireAt"]
    state = _normalize(entstore.read_state(root, app), now)
    cur = _ts(state["timeExpireAt"]) if state["timeExpireAt"] else 0
    if _ts(exp) > cur:
        state["timeExpireAt"] = exp
    if now > state.get("seenMax", 0):
        state["seenMax"] = now
    entstore.write_state(root, state)
    return {"ok": True, "timeExpireAt": state["timeExpireAt"]}
```

> 注:`verify_shortcode` 第二参是机器指纹 bytes。既有 `service.activate_serial` 已用 `bytes.fromhex(_fp(root))`,此处一致。

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_engine_redeem.py -q`
Expected: PASS（9 passed）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/engine.py chayuan-server/libs/chayuan-server/tests/server/license/test_engine_redeem.py
git commit -m "feat(license): engine.redeem_shortcode 25 位短码时间入 entstore"
```

---

### Task 7: `config.py` 增 `daily_free` 配额配置

**Files:**
- Modify: `chayuan/server/license/config.py`
- Test: `tests/server/license/test_config.py`（追加）

> `load_license_config()` 现已返回 `{active_key_id, hmac_keys, public_key, buy_base_url, products, configured}`。新增 `daily_free`:env `LICENSE_DAILY_FREE`(JSON)优先,其次 `license_settings.yaml` 的 `daily_free`,默认 `{}`(各模块默认 0 次免费,由 Plan D 后台配置覆盖)。

- [ ] **Step 1: 追加失败测试**

Append to `tests/server/license/test_config.py`:

```python
import json as _json


def test_daily_free_from_env(monkeypatch):
    monkeypatch.setenv("LICENSE_DAILY_FREE", _json.dumps({"video": 2, "chat": 10}))
    cfg = load_license_config()
    assert cfg["daily_free"]["video"] == 2
    assert cfg["daily_free"]["chat"] == 10


def test_daily_free_default_empty(monkeypatch):
    monkeypatch.delenv("LICENSE_DAILY_FREE", raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", "/nonexistent-xyz")
    cfg = load_license_config()
    assert cfg["daily_free"] == {}


def test_daily_free_bad_json_falls_back(monkeypatch):
    monkeypatch.setenv("LICENSE_DAILY_FREE", "{not json")
    cfg = load_license_config()
    assert cfg["daily_free"] == {}


def test_free_modules_from_env(monkeypatch):
    monkeypatch.setenv("LICENSE_FREE_MODULES", _json.dumps(["kb", "chat"]))
    cfg = load_license_config()
    assert set(cfg["free_modules"]) == {"kb", "chat"}


def test_free_modules_default_empty(monkeypatch):
    monkeypatch.delenv("LICENSE_FREE_MODULES", raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", "/nonexistent-xyz")
    cfg = load_license_config()
    assert cfg["free_modules"] == []
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_config.py -k daily_free -q`
Expected: FAIL — `KeyError: 'daily_free'`。

- [ ] **Step 3: 在 `config.py` 的 `load_license_config` 返回 dict 里加 `daily_free`**

在 `load_license_config()` 内,`products` 计算之后、`return {...}` 之前插入:

```python
    # 每日免费配额:env(JSON)优先,其次文件 daily_free,默认空。
    daily_free = {}
    env_df = os.environ.get("LICENSE_DAILY_FREE")
    if env_df:
        try:
            v = json.loads(env_df)
            daily_free = {str(k): int(x) for k, x in v.items()} if isinstance(v, dict) else {}
        except Exception:
            daily_free = {}
    elif isinstance(f.get("daily_free"), dict):
        daily_free = {str(k): int(x) for k, x in f["daily_free"].items()}

    # 免费模块:整模块不门控(定价="免费")。env(JSON 数组)优先,其次文件 free_modules。
    free_modules = []
    env_fm = os.environ.get("LICENSE_FREE_MODULES")
    if env_fm:
        try:
            v = json.loads(env_fm)
            free_modules = [str(x) for x in v] if isinstance(v, list) else []
        except Exception:
            free_modules = []
    elif isinstance(f.get("free_modules"), list):
        free_modules = [str(x) for x in f["free_modules"]]
```

并在 `return {...}` 字典里加两行:

```python
        "daily_free": daily_free,
        "free_modules": free_modules,
```

> `f` 是函数里已有的 `_load_file()` 结果(license_settings.yaml);`json` / `os` 已在文件顶部 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_config.py -q`
Expected: PASS（原有 + 3 新,全过)。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/license/config.py chayuan-server/libs/chayuan-server/tests/server/license/test_config.py
git commit -m "feat(license): config 增 daily_free 每日免费配额(env/yaml)"
```

---

### Task 8: 路由 — `/consume /redeem` + 改写 `/status /entitlements /activate /activate-token` + 全局锁

**Files:**
- Modify: `chayuan/server/api_server/license_routes.py`
- Test: `tests/server/license/test_routes_entitlement.py`

> 用模块级 `asyncio.Lock` 串行化所有**变更**操作(consume/redeem/activate),避免并发读改写少扣/超发。读操作(status/entitlements)不加锁。

- [ ] **Step 1: 写失败测试**

Create `tests/server/license/test_routes_entitlement.py`:

```python
import asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes

PUB_HEX = public_key_bytes().hex()
KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", KEY)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", PUB_HEX)
    monkeypatch.setenv("LICENSE_DAILY_FREE", '{"video": 2}')
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)


def test_status_has_new_fields(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    s = c.get("/api/v1/license/status?app=video").json()
    assert s["dailyFree"] == 2 and s["remainingFree"] == 2 and s["counts"] == 0


def test_consume_decrements_free(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/consume", json={"app": "video"}).json()
    assert r["allowed"] is True and r["source"] == "free" and r["remainingFree"] == 1


def test_redeem_applies_counts(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    code = sign_entcode({"v": 1, "id": "x1", "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 7}]})
    r = c.post("/api/v1/license/redeem", json={"code": code}).json()
    assert r["ok"] is True
    assert c.get("/api/v1/license/status?app=video").json()["counts"] == 7


def test_redeem_twice_rejected(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    code = sign_entcode({"v": 1, "id": "dup", "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 7}]})
    assert c.post("/api/v1/license/redeem", json={"code": code}).json()["ok"] is True
    assert c.post("/api/v1/license/redeem", json={"code": code}).json()["reason"] == "used"


def test_invalid_app_consume_rejected(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/consume", json={"app": "../etc"}).json()
    assert r["allowed"] is False and r["reason"] == "invalid-app"


def test_concurrent_consume_no_oversell(tmp_path, monkeypatch):
    # 充 5 次,免费 2 次,并发 20 次 consume → 允许次数恰为 7(2 免费 + 5 次),不超发。
    c = _client(tmp_path, monkeypatch)
    code = sign_entcode({"v": 1, "id": "c5", "src": "promo", "mid": None,
                         "cardExpireAt": None, "grants": [{"app": "video", "kind": "count", "n": 5}]})
    c.post("/api/v1/license/redeem", json={"code": code})
    import concurrent.futures
    def one():
        return c.post("/api/v1/license/consume", json={"app": "video"}).json()["allowed"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda _: one(), range(20)))
    assert sum(1 for x in results if x) == 7
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_routes_entitlement.py -q`
Expected: FAIL — 新字段缺失 / 404 路由不存在。

- [ ] **Step 3: 改写 `license_routes.py`**

在文件顶部 import 区加:

```python
import threading
from chayuan.server.license import engine
```

> 用 `threading.Lock`(不是 asyncio.Lock):路由用普通 `def`(同步),TestClient/uvicorn 在线程池跑,`threading.Lock` 对线程并发与同步处理函数都正确。全局一把锁串行化所有变更操作;读操作不加锁。

在 `license_router = APIRouter(...)` 之后加:

```python
_mutate_lock = threading.Lock()
```

把现有 `get_status` 改成走 engine(向后兼容旧字段 `licensed`):

```python
@license_router.get("/status")
def get_status(app: str = Query("video")):
    if not _valid_app(app):
        return {"licensed": False, "reason": "invalid-app"}
    cfg = load_license_config()
    return engine.status(_root(), app, cfg)
```

新增 consume / redeem:

```python
@license_router.post("/consume")
def post_consume(payload: dict = Body(...)):
    app = payload.get("app", "video")
    if not _valid_app(app):
        return {"allowed": False, "source": "none", "reason": "invalid-app"}
    cfg = load_license_config()
    with _mutate_lock:
        return engine.consume(_root(), app, cfg)


@license_router.post("/redeem")
def post_redeem(payload: dict = Body(...)):
    code = payload.get("code", "")
    if not isinstance(code, str) or not code:
        return {"ok": False, "reason": "empty"}
    cfg = load_license_config()
    with _mutate_lock:
        return engine.redeem(_root(), code, cfg)
```

把现有 `post_activate`(25 位短码)改走 engine:

```python
@license_router.post("/activate")
def post_activate(payload: dict = Body(...)):
    app = payload.get("app", "video")
    if not _valid_app(app):
        return {"ok": False, "reason": "invalid-app"}
    cfg = load_license_config()
    with _mutate_lock:
        return engine.redeem_shortcode(_root(), payload.get("serial", ""), app, cfg)
```

把现有 `post_activate_token`(.lic 令牌)改走 engine.redeem(统一路径,兼容旧令牌形状):

```python
@license_router.post("/activate-token")
def post_activate_token(payload: dict = Body(...)):
    cfg = load_license_config()
    with _mutate_lock:
        return engine.redeem(_root(), payload.get("token", ""), cfg)
```

`/entitlements` 保持读 engine 各模块状态(若已存在则改为遍历 `cfg["daily_free"]`/products 的 app 调 `engine.status`;无则保留既有在线聚合逻辑,本任务不强改)。最小改动:在既有 `get_entitlements` 的本地回落分支里,把 `service.current_status` 换成 `engine.status` 以反映新状态字段。

> 注:`Body` / `Query` / `_valid_app` / `_root` / `load_license_config` 均为该文件既有 import / 函数,无需重复定义。

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_routes_entitlement.py -q`
Expected: PASS（6 passed,含并发不超发）。

- [ ] **Step 5: 跑既有 license 路由测试确认未回归**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/test_routes.py -q`
Expected: PASS(既有 fingerprint/buy-url/invalid-app 等仍绿;若 `test_activate_serial_route_uses_local_fp` 因走 engine 后返回结构变化而断言失配,按"非法短码 → ok:False"调整其断言:`r.json()["ok"] is False`)。

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/license_routes.py chayuan-server/libs/chayuan-server/tests/server/license/test_routes_entitlement.py chayuan-server/libs/chayuan-server/tests/server/license/test_routes.py
git commit -m "feat(license): 路由 /consume /redeem + status/activate 走 engine + 全局变更锁(并发不超发)"
```

---

### Task 9: 全量回归 + 黄金向量固化 + 自检

**Files:** 无新增(验证 + 可能微调)

- [ ] **Step 1: 全量 license 测试**

Run: `PYTHONPATH=. python3 -m pytest tests/server/license/ -q`
Expected: 全 PASS(entstore/entcode/engine/engine_redeem/config/routes + 既有 base32/codec/shortcode/token/fingerprint_store)。

- [ ] **Step 2: 固化跨实现黄金向量(供 Plan B website 对齐)**

把测试签发器产出的一条权益码 + 公钥落进 spec 末尾,供 Plan B 复现。运行并记录:

```bash
PYTHONPATH=. python3 -c "
from tests.server.license._entcode_sign import sign_entcode, public_key_bytes
p={'v':1,'id':'a1b2c3d4e5f60718','src':'promo','mid':None,'cardExpireAt':'2026-12-31T00:00:00.000Z','grants':[{'app':'video','kind':'count','n':5},{'app':'chat','kind':'time','days':30}]}
print('PUBKEY_HEX', public_key_bytes().hex())
print('CODE', sign_entcode(p))
"
```

把输出的 `PUBKEY_HEX` 与 `CODE` 追加到设计 spec `2026-05-31-multi-module-entitlement-design.md` 末尾"## 12. 黄金向量(Plan A↔B 字节兼容)"小节,并 commit。

- [ ] **Step 3: py_compile 改动文件**

Run:
```bash
PYTHONPATH=. python3 -m py_compile \
  chayuan/server/license/entstore.py chayuan/server/license/entcode.py \
  chayuan/server/license/engine.py chayuan/server/license/config.py \
  chayuan/server/api_server/license_routes.py
```
Expected: 无输出(编译通过)。

- [ ] **Step 4: 收尾自检**

确认:三级判定优先级正确;防重放全局生效;时间叠加/次数累加正确;并发不超发;旧短码/旧 .lic 仍可核销;`/status` 向后兼容旧字段(`licensed`)。`git status` 无误改无关文件。

- [ ] **Step 5: commit(若 Step 2 有 spec 追加)**

```bash
cd /work/chayuan-desktop
git add docs/superpowers/specs/2026-05-31-multi-module-entitlement-design.md
git commit -m "docs(license): 固化 Plan A↔B 统一权益码黄金向量"
```

---

## Self-Review(计划自检)

- **Spec 覆盖**:§2 状态模型→Task1;§2.1 免费模块短路→Task3/4(engine free_modules)+Task7(config);§2.1 三级判定→Task3/4;§2.2 并发锁→Task8;§3 统一权益码→Task2/5;§3 旧短码/旧令牌兼容→Task6/Task8;§9 防重放/绑机/单次→Task5;每日清零→Task3;防回拨→Task3/4;daily_free 配置→Task7;API(status/consume/redeem/entitlements)→Task8;黄金向量→Task2/Task9。✅(§4 买页、§5 后台、§6 分享/赠送/回报、§7 前端属 Plan B–E,本计划不含。)
- **占位扫描**:每个代码步骤均给完整代码;命令均给预期输出;无 TBD。✅
- **类型/签名一致**:`entstore.read_state/write_state/state_path/read_redeemed/is_redeemed/add_redeemed`、`entcode.verify/validate_payload`、`engine.status/consume/redeem/redeem_shortcode/_ts/_to_iso/_today/_apply_grant/_code_id_of` 全程一致;状态字段 `timeExpireAt/counts/freeUsedToday/freeDate/seenMax` 各处一致;cfg 键 `daily_free/public_key/hmac_keys` 一致。✅
- **范围**:单子系统(chayuan-server 验证/状态机),适合单计划,可独立测。✅

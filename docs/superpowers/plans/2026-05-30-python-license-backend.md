# Python 授权验证后端 Implementation Plan (1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** 在 chayuan-server(Python) 里实现授权序列号**验证**（B1 短码 + Ed25519 令牌）、机器指纹、防回拨、偶尔在线自动激活，并通过 `/api/v1/license/*` 给前端调。与 website 签发**字节兼容**（过黄金向量）。

**Architecture:** 新建 `chayuan/server/license/` 纯逻辑包（base32/codec/shortcode/token/fingerprint/store/service/config）+ `api_server/license_routes.py` 路由，挂进 `server_app.py`。验证用标准库 `hmac/hashlib` + `cryptography` 的 Ed25519。

**Tech Stack:** Python 3、FastAPI、`cryptography>=42`、`hmac`/`hashlib`、pytest。

> 依据：`docs/superpowers/specs/2026-05-30-python-license-verification-design.md`。
> 包根：`/work/chayuan-desktop/chayuan-server/libs/chayuan-server`（下称 PKG）。
> 测试跑法：`cd PKG && PYTHONPATH=. python3 -m pytest <file> -q`。
> 数据目录：`chayuan.settings.CHAYUAN_ROOT`（Path）。

## 黄金向量（来自 website server/license，所有验签必须过）

```
HMAC key (hex,32B): 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
fp (hex,8B):        1122334455667788
serial:             2101W-0JWN1-MN2JP-9V4QW-MSGJ   → valid, durDays=30, issueDate=151, expireAt=2026-07-01T00:00:00.000Z
Ed25519 pub (hex):  3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be
token:              eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwibWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0.8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg
                    (payload: app=video, mid=1122334455667788, exp=1782864000, durDays=30)
```

## File Structure
- `chayuan/server/license/__init__.py`
- `chayuan/server/license/base32.py` — Crockford 解码 + 校验符
- `chayuan/server/license/codec.py` — 头解包 + 日期
- `chayuan/server/license/shortcode.py` — B1 短码验签
- `chayuan/server/license/token.py` — Ed25519 令牌验签
- `chayuan/server/license/fingerprint.py` — 机器指纹（持久化）
- `chayuan/server/license/store.py` — 防回拨激活记录
- `chayuan/server/license/service.py` — 编排（status/activate/online）
- `chayuan/server/license/config.py` — 从 env 读密钥/配置
- `chayuan/server/api_server/license_routes.py` — FastAPI 路由
- `chayuan/server/api_server/server_app.py` — 注册路由（改）
- 测试：`tests/server/license/test_*.py`

---

### Task 1: base32.py

**Files:** Create `chayuan/server/license/__init__.py`(空), `chayuan/server/license/base32.py`; Test `tests/server/license/__init__.py`(空), `tests/server/license/test_base32.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_base32.py
from chayuan.server.license.base32 import decode, check_char

def test_decode_maps_confusables_and_case():
    # "O"->0, "I"/"L"->1, 大小写不敏感
    assert decode("ABC") == decode("abc")

def test_decode_invalid_raises():
    import pytest
    with pytest.raises(ValueError):
        decode("!!!")

def test_check_char_deterministic_and_37_alphabet():
    c = check_char(bytes([1, 2, 3, 4]))
    assert c == check_char(bytes([1, 2, 3, 4]))
    assert c in "0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U"

def test_check_char_changes_on_byte_change():
    assert check_char(bytes([1, 2, 3, 4])) != check_char(bytes([1, 2, 3, 5]))
```

- [ ] **Step 2: run + fail** — `cd PKG && PYTHONPATH=. python3 -m pytest tests/server/license/test_base32.py -q`

- [ ] **Step 3: implement**

```python
# chayuan/server/license/base32.py
"""Crockford Base32 解码 + mod-37 校验符。与 website server/license/base32.js 字节兼容。"""

_ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CHECK = _ENC + "*~$=U"
_DEC = {c: i for i, c in enumerate(_ENC)}
_DEC["O"] = 0
_DEC["I"] = 1
_DEC["L"] = 1


def decode(s: str) -> bytes:
    bits = 0
    value = 0
    out = bytearray()
    for raw in s.upper():
        if raw == "-":
            continue
        v = _DEC.get(raw)
        if v is None:
            raise ValueError(f"invalid base32 symbol: {raw}")
        value = (value << 5) | v
        bits += 5
        if bits >= 8:
            out.append((value >> (bits - 8)) & 0xFF)
            bits -= 8
            value &= (1 << bits) - 1
    return bytes(out)


def check_char(buf: bytes) -> str:
    n = 0
    for b in buf:
        n = (n * 256 + b) % 37
    return _CHECK[n]
```

- [ ] **Step 4: run + pass.**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python Crockford base32 解码+校验符"`

---

### Task 2: codec.py

**Files:** Create `chayuan/server/license/codec.py`; Test `tests/server/license/test_codec.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_codec.py
from chayuan.server.license.codec import unpack, issue_to_date, to_iso

def test_unpack_known_header():
    # header for ver1 app1 durDays30 issueDate151 nonce42 (from golden serial)
    # 6 字节,见 shortcode 测试用真实串;这里直接验证位宽往返
    fields = {"ver": 1, "app": 1, "durDays": 30, "issueDate": 151, "nonce": 42}
    # 用 pack 反推(本模块只需 unpack;这里手工构造 header 字节验证)
    v = ((((1 << 6 | 1) << 14 | 30) << 14 | 151) << 8 | 42) << 2
    header = v.to_bytes(6, "big")
    assert unpack(header) == fields

def test_issue_to_date_and_iso():
    d = issue_to_date(151)  # 2026-01-01 + 151 天 = 2026-06-01
    assert to_iso(d) == "2026-06-01T00:00:00.000Z"
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement**

```python
# chayuan/server/license/codec.py
"""6 字节头解包 + 日期。与 website server/license/codec.js 一致。"""
from datetime import datetime, timedelta, timezone

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
_WIDTHS = {"ver": 4, "app": 6, "durDays": 14, "issueDate": 14, "nonce": 8}
_ORDER = ["ver", "app", "durDays", "issueDate", "nonce"]


def unpack(buf: bytes) -> dict:
    v = int.from_bytes(buf, "big") >> 2  # 丢低 2 保留位
    out = {}
    for k in reversed(_ORDER):
        w = _WIDTHS[k]
        out[k] = v & ((1 << w) - 1)
        v >>= w
    return out


def issue_to_date(n: int) -> datetime:
    return EPOCH + timedelta(days=n)


def to_iso(dt: datetime) -> str:
    """与 JS Date.toISOString() 同形:毫秒 + Z。"""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
```

- [ ] **Step 4: run + pass.**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python 头解包 codec"`

---

### Task 3: shortcode.py（B1 验签，过黄金向量）

**Files:** Create `chayuan/server/license/shortcode.py`; Test `tests/server/license/test_shortcode.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_shortcode.py
from chayuan.server.license.shortcode import verify_shortcode

KEY = bytes.fromhex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
FP = bytes.fromhex("1122334455667788")
SERIAL = "2101W-0JWN1-MN2JP-9V4QW-MSGJ"
KEYS = {1: KEY}

def test_golden_serial_verifies():
    r = verify_shortcode(SERIAL, FP, KEYS)
    assert r["valid"] is True
    assert r["fields"]["durDays"] == 30
    assert r["expireAt"] == "2026-07-01T00:00:00.000Z"

def test_wrong_machine_fails():
    r = verify_shortcode(SERIAL, bytes.fromhex("8877665544332211"), KEYS)
    assert r["valid"] is False and r["reason"] == "signature"

def test_tampered_checksum():
    nd = SERIAL.replace("-", "")
    flipped = ("B" if nd[0] == "A" else "A") + nd[1:]
    r = verify_shortcode(flipped, FP, KEYS)
    assert r["valid"] is False and r["reason"] == "checksum"

def test_unknown_key_version():
    r = verify_shortcode(SERIAL, FP, {})
    assert r["valid"] is False and r["reason"] == "unknown-key"

def test_lowercase_and_no_dash():
    r = verify_shortcode(SERIAL.replace("-", "").lower(), FP, KEYS)
    assert r["valid"] is True
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement**

```python
# chayuan/server/license/shortcode.py
"""B1 截断 HMAC 短码验签。与 website server/license/shortcode.js 字节兼容。"""
import hmac
import hashlib
from datetime import timedelta

from .base32 import decode, check_char
from .codec import unpack, issue_to_date, to_iso


def verify_shortcode(serial: str, machine_fp: bytes, hmac_keys: dict) -> dict:
    norm = serial.replace("-", "").upper()
    if len(norm) != 24:
        return {"valid": False, "reason": "length"}
    try:
        body = decode(norm[:23])
    except ValueError:
        return {"valid": False, "reason": "decode"}
    if len(body) != 14:
        return {"valid": False, "reason": "decode"}
    if check_char(body) != norm[23]:
        return {"valid": False, "reason": "checksum"}

    header = body[:6]
    given_tag = body[6:14]
    fields = unpack(header)

    key = hmac_keys.get(fields["ver"])
    if not key:
        return {"valid": False, "reason": "unknown-key"}

    tag = hmac.new(key, header + machine_fp, hashlib.sha256).digest()[:8]
    if not hmac.compare_digest(tag, given_tag):
        return {"valid": False, "reason": "signature"}

    expire = issue_to_date(fields["issueDate"]) + timedelta(days=fields["durDays"])
    return {"valid": True, "fields": fields, "expireAt": to_iso(expire)}
```

- [ ] **Step 4: run + pass（5 测试，含黄金向量）。**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python B1 短码验签(过黄金向量)"`

---

### Task 4: token.py（Ed25519 验签，过黄金向量）

**Files:** Create `chayuan/server/license/token.py`; Test `tests/server/license/test_token.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_token.py
from chayuan.server.license.token import verify_token

PUB = bytes.fromhex("3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be")
TOKEN = (
    "eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwi"
    "bWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0"
    ".8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg"
)

def test_golden_token_verifies():
    r = verify_token(TOKEN, PUB)
    assert r["valid"] is True
    assert r["payload"]["mid"] == "1122334455667788"
    assert r["payload"]["app"] == "video"
    assert r["payload"]["exp"] == 1782864000

def test_wrong_pubkey_fails():
    assert verify_token(TOKEN, bytes(32)) ["valid"] is False

def test_tampered_payload_fails():
    p, sig = TOKEN.split(".")
    import base64, json
    bad = base64.urlsafe_b64encode(json.dumps({"mid": "x"}).encode()).decode().rstrip("=")
    assert verify_token(bad + "." + sig, PUB)["valid"] is False

def test_garbage_returns_invalid_not_raise():
    assert verify_token("garbage", PUB)["valid"] is False
    assert verify_token("", PUB)["valid"] is False
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement**

```python
# chayuan/server/license/token.py
"""Ed25519 强签名令牌验签。与 website server/license/token.js 兼容(仅需公钥)。"""
import json
import base64

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature


def _b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_token(token: str, public_key: bytes) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return {"valid": False}
        msg = _b64url(parts[0])
        sig = _b64url(parts[1])
        Ed25519PublicKey.from_public_bytes(public_key).verify(sig, msg)
        return {"valid": True, "payload": json.loads(msg.decode("utf-8"))}
    except (InvalidSignature, ValueError, Exception):
        return {"valid": False}
```

- [ ] **Step 4: run + pass.**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python Ed25519 令牌验签(过黄金向量)"`

---

### Task 5: fingerprint.py + store.py

**Files:** Create `chayuan/server/license/fingerprint.py`, `chayuan/server/license/store.py`; Test `tests/server/license/test_fingerprint_store.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_fingerprint_store.py
import re
from chayuan.server.license.fingerprint import fingerprint
from chayuan.server.license import store

def test_fingerprint_stable_16hex(tmp_path):
    a = fingerprint(tmp_path)
    b = fingerprint(tmp_path)
    assert a == b
    assert re.fullmatch(r"[0-9a-f]{16}", a)

def test_store_roundtrip(tmp_path):
    rec = {"mid": "1122334455667788", "app": "video", "expireAt": "2026-07-01T00:00:00.000Z", "seenMax": 1, "source": "shortcode", "credential": "S"}
    store.write_activation(tmp_path, rec)
    assert store.read_activation(tmp_path, "video")["mid"] == "1122334455667788"

def test_store_missing_returns_none(tmp_path):
    assert store.read_activation(tmp_path, "nope") is None
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement**

```python
# chayuan/server/license/fingerprint.py
"""机器指纹:持久化一个稳定机器ID,hex(sha256(id))[:16](8 字节)。单机绑定用。"""
import hashlib
import uuid
from pathlib import Path


def _stable_machine_id(root: Path) -> str:
    f = root / "license" / "machine.id"
    try:
        if f.exists():
            s = f.read_text().strip()
            if s:
                return s
    except Exception:
        pass
    mid = ""
    try:
        mid = Path("/etc/machine-id").read_text().strip()  # Linux
    except Exception:
        mid = ""
    if not mid:
        try:
            import winreg  # type: ignore
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\\Microsoft\\Cryptography")
            mid = winreg.QueryValueEx(k, "MachineGuid")[0]
        except Exception:
            mid = ""
    if not mid:
        mid = uuid.uuid4().hex  # 兜底:随机一次,落盘后稳定
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(mid)
    except Exception:
        pass
    return mid


def fingerprint(root: Path) -> str:
    return hashlib.sha256(_stable_machine_id(root).encode()).hexdigest()[:16]


def fingerprint_bytes(root: Path) -> bytes:
    return bytes.fromhex(fingerprint(root))
```

```python
# chayuan/server/license/store.py
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
```

- [ ] **Step 4: run + pass.**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python 机器指纹(持久化) + 防回拨记录存储"`

---

### Task 6: service.py（编排:status/activate/在线自动激活）

**Files:** Create `chayuan/server/license/service.py`; Test `tests/server/license/test_service.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_service.py
from datetime import datetime, timezone
from chayuan.server.license import service, store

KEY = bytes.fromhex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
PUB = bytes.fromhex("3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be")
SERIAL = "2101W-0JWN1-MN2JP-9V4QW-MSGJ"
TOKEN = (
    "eyJhcHAiOiJ2aWRlbyIsImR1ckRheXMiOjMwLCJleHAiOjE3ODI4NjQwMDAsImlhdCI6MTc4MDMwODAwMCwi"
    "bWlkIjoiMTEyMjMzNDQ1NTY2Nzc4OCIsIm5vbmNlIjo0Miwib2lkIjoiT1JEMSIsInNyYyI6InB1cmNoYXNlIiwidiI6MX0"
    ".8nro0H0A6DzEvHNwvqkaEsBoVcCI4UIaWOaQiZ7tCVQ6BoSlmfK7EB0nrvovGYI_K-YHtkhYUqzYD_AwB6vDBg"
)
# fp 必须等于 1122334455667788 才能过黄金向量 → 测试里固定 mid
CFG = {"hmac_keys": {1: KEY}, "public_key": PUB, "buy_base_url": "https://aidooo.com"}
NOW = datetime(2026, 6, 15, tzinfo=timezone.utc).timestamp()
MID = "1122334455667788"

def test_activate_serial_then_status(tmp_path):
    s = service.activate_serial(tmp_path, "video", SERIAL, CFG, fp=MID, now=NOW)
    assert s["licensed"] is True and s["source"] == "shortcode"
    st = service.current_status(tmp_path, "video", CFG, fp=MID, now=NOW)
    assert st["licensed"] is True

def test_activate_token_file(tmp_path):
    s = service.activate_token(tmp_path, "video", TOKEN, "file", CFG, fp=MID, now=NOW)
    assert s["licensed"] is True and s["source"] == "file"

def test_wrong_machine_token_rejected(tmp_path):
    s = service.activate_token(tmp_path, "video", TOKEN, "file", CFG, fp="8877665544332211", now=NOW)
    assert s["licensed"] is False and s["reason"] == "mismatch"

def test_rollback_detected(tmp_path):
    store.write_activation(tmp_path, {"mid": MID, "app": "video", "expireAt": "2026-07-01T00:00:00.000Z", "seenMax": datetime(2026, 6, 20, tzinfo=timezone.utc).timestamp(), "source": "file", "credential": TOKEN})
    st = service.current_status(tmp_path, "video", CFG, fp=MID, now=datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
    assert st["licensed"] is False and st["reason"] == "rollback"

def test_online_auto_activate(tmp_path):
    import json
    calls = {}
    def http_get(url):
        calls["url"] = url
        return json.dumps({"token": TOKEN})
    st = service.current_status(tmp_path, "video", CFG, fp=MID, now=NOW, http_get=http_get)
    assert st["licensed"] is True and st["source"] == "online"
    assert "mid=" + MID in calls["url"]
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement**

```python
# chayuan/server/license/service.py
"""授权编排:本地态(防回拨+过期)+ 短码/令牌激活 + 偶尔在线自动激活。"""
from datetime import datetime, timezone

from .shortcode import verify_shortcode
from .token import verify_token
from .codec import to_iso
from . import store
from .fingerprint import fingerprint as _fp

ROLLBACK_TOLERANCE = 86400  # 1 天(秒)


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def _fp_of(root, fp):
    return fp if fp is not None else _fp(root)


def current_status(root, app, cfg, *, fp=None, now=None, http_get=None) -> dict:
    now = now if now is not None else _now()
    rec = store.read_activation(root, app)
    if not rec:
        if http_get:
            s = activate_online(root, app, cfg, fp=fp, now=now, http_get=http_get)
            if s["licensed"]:
                return s
        return {"licensed": False, "app": app, "reason": "none"}
    if now < rec["seenMax"] - ROLLBACK_TOLERANCE:
        return {"licensed": False, "app": app, "reason": "rollback", "expireAt": rec["expireAt"], "source": rec.get("source")}
    if now > _ts(rec["expireAt"]):
        return {"licensed": False, "app": app, "reason": "expired", "expireAt": rec["expireAt"], "source": rec.get("source")}
    if now > rec["seenMax"]:
        rec["seenMax"] = now
        store.write_activation(root, rec)
    return {"licensed": True, "app": app, "expireAt": rec["expireAt"], "source": rec.get("source")}


def activate_serial(root, app, serial, cfg, *, fp=None, now=None) -> dict:
    now = now if now is not None else _now()
    fph = _fp_of(root, fp)
    r = verify_shortcode(serial, bytes.fromhex(fph), cfg["hmac_keys"])
    if not r["valid"]:
        return {"licensed": False, "app": app, "reason": r["reason"]}
    if _ts(r["expireAt"]) <= now:
        return {"licensed": False, "app": app, "reason": "expired"}
    rec = {"mid": fph, "app": app, "expireAt": r["expireAt"], "seenMax": now, "source": "shortcode", "credential": serial}
    store.write_activation(root, rec)
    return {"licensed": True, "app": app, "expireAt": r["expireAt"], "source": "shortcode"}


def activate_token(root, app, token, source, cfg, *, fp=None, now=None) -> dict:
    now = now if now is not None else _now()
    fph = _fp_of(root, fp)
    r = verify_token(token, cfg["public_key"])
    if not r["valid"]:
        return {"licensed": False, "app": app, "reason": "none"}
    p = r["payload"]
    if p.get("app") != app or str(p.get("mid", "")).lower() != fph.lower():
        return {"licensed": False, "app": app, "reason": "mismatch"}
    if p["exp"] * 1000 <= now * 1000:
        return {"licensed": False, "app": app, "reason": "expired"}
    expire = to_iso(datetime.fromtimestamp(p["exp"], tz=timezone.utc))
    rec = {"mid": fph, "app": app, "expireAt": expire, "seenMax": now, "source": source, "credential": token}
    store.write_activation(root, rec)
    return {"licensed": True, "app": app, "expireAt": expire, "source": source}


def activate_online(root, app, cfg, *, fp=None, now=None, http_get=None) -> dict:
    import json
    import urllib.request
    fph = _fp_of(root, fp)
    base = cfg.get("buy_base_url", "https://aidooo.com")
    url = f"{base}/api/license/entitlement?mid={fph}&app={app}"
    getter = http_get or (lambda u: urllib.request.urlopen(u, timeout=8).read().decode("utf-8"))
    try:
        token = json.loads(getter(url)).get("token")
    except Exception:
        return {"licensed": False, "app": app, "reason": "none"}
    if not token:
        return {"licensed": False, "app": app, "reason": "none"}
    return activate_token(root, app, token, "online", cfg, fp=fph, now=now)
```

- [ ] **Step 4: run + pass（5 测试）。**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python 授权编排(防回拨/激活/在线自动激活)"`

---

### Task 7: config.py（从 env 读密钥/配置）

**Files:** Create `chayuan/server/license/config.py`; Test `tests/server/license/test_config.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_config.py
from chayuan.server.license.config import load_license_config

def test_load_from_env(monkeypatch):
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", "00" * 32)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", "11" * 32)
    monkeypatch.setenv("LICENSE_BUY_BASE_URL", "https://aidooo.com")
    cfg = load_license_config()
    assert cfg["hmac_keys"][1] == bytes.fromhex("00" * 32)
    assert cfg["public_key"] == bytes.fromhex("11" * 32)
    assert cfg["buy_base_url"] == "https://aidooo.com"
    assert cfg["products"]["video"] == 1

def test_missing_keys_marks_unconfigured(monkeypatch):
    monkeypatch.delenv("LICENSE_HMAC_KEY_V1", raising=False)
    monkeypatch.delenv("LICENSE_ED25519_PUBLIC_KEY", raising=False)
    cfg = load_license_config()
    assert cfg["configured"] is False
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement**

```python
# chayuan/server/license/config.py
"""授权验证配置:从 env 读(桌面打包注入)。HMAC 与 website 同一把;Ed25519 仅公钥。"""
import os
import json


def load_license_config() -> dict:
    active = int(os.environ.get("LICENSE_ACTIVE_KEY_ID", "1"))
    hmac_hex = os.environ.get("LICENSE_HMAC_KEY_V1", "")
    pub_hex = os.environ.get("LICENSE_ED25519_PUBLIC_KEY", "")
    try:
        products = json.loads(os.environ.get("LICENSE_PRODUCTS", "")) if os.environ.get("LICENSE_PRODUCTS") else {"video": 1}
    except Exception:
        products = {"video": 1}
    hmac_keys = {}
    if hmac_hex:
        hmac_keys[active] = bytes.fromhex(hmac_hex)
    public_key = bytes.fromhex(pub_hex) if pub_hex else b""
    return {
        "active_key_id": active,
        "hmac_keys": hmac_keys,
        "public_key": public_key,
        "buy_base_url": os.environ.get("LICENSE_BUY_BASE_URL", "https://aidooo.com"),
        "products": products,
        "configured": bool(hmac_keys and public_key),
    }
```

- [ ] **Step 4: run + pass.**
- [ ] **Step 5: commit** — `git commit -m "feat(license): Python 授权配置(env 注入)"`

---

### Task 8: license_routes.py + 注册 + 集成测试

**Files:** Create `chayuan/server/api_server/license_routes.py`; Modify `chayuan/server/api_server/server_app.py`; Test `tests/server/license/test_routes.py`

- [ ] **Step 1: failing test**

```python
# tests/server/license/test_routes.py
import os
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router

KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
PUB = "3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be"

def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.setenv("LICENSE_HMAC_KEY_V1", KEY)
    monkeypatch.setenv("LICENSE_ED25519_PUBLIC_KEY", PUB)
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)

def test_fingerprint_and_status_none(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    fp = c.get("/api/v1/license/fingerprint").json()["fingerprint"]
    assert len(fp) == 16
    st = c.get("/api/v1/license/status?app=video").json()
    assert st["licensed"] is False

def test_buy_url(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    u = c.get("/api/v1/license/buy-url?app=video").json()["url"]
    assert u.startswith("https://aidooo.com/buy?app=video&mid=")

def test_activate_serial_route_uses_local_fp(tmp_path, monkeypatch):
    # 用本机指纹签发一个短码 → 需 fp 匹配;这里直接测「非法短码 -> licensed false」
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/v1/license/activate", json={"app": "video", "serial": "WRONG-CODE-XXXXX-YYYYY-ZZZZ"})
    assert r.status_code == 200 and r.json()["licensed"] is False
```

- [ ] **Step 2: run + fail.**

- [ ] **Step 3: implement license_routes.py**

```python
# chayuan/server/api_server/license_routes.py
"""授权验证 HTTP 路由(挂 /api/v1/license)。单机匿名透明放行,前端(桌面/网页同一套)调用。"""
from __future__ import annotations

from fastapi import APIRouter, Body, Query

from chayuan.settings import CHAYUAN_ROOT
from chayuan.server.license import service
from chayuan.server.license.config import load_license_config
from chayuan.server.license.fingerprint import fingerprint as _fp

license_router = APIRouter(prefix="/api/v1/license", tags=["license"])


def _root():
    from pathlib import Path
    return Path(CHAYUAN_ROOT)


@license_router.get("/fingerprint")
def get_fingerprint():
    return {"fingerprint": _fp(_root())}


@license_router.get("/buy-url")
def get_buy_url(app: str = Query("video")):
    cfg = load_license_config()
    fp = _fp(_root())
    return {"url": f"{cfg['buy_base_url']}/buy?app={app}&mid={fp}"}


@license_router.get("/status")
def get_status(app: str = Query("video")):
    cfg = load_license_config()
    # 偶尔在线:status 时尝试在线自动激活(联网才会成功,断网静默)
    return service.current_status(_root(), app, cfg, http_get=None if not cfg["configured"] else _safe_get)


@license_router.post("/activate")
def post_activate(payload: dict = Body(...)):
    cfg = load_license_config()
    return service.activate_serial(_root(), payload.get("app", "video"), payload.get("serial", ""), cfg)


@license_router.post("/activate-token")
def post_activate_token(payload: dict = Body(...)):
    cfg = load_license_config()
    return service.activate_token(_root(), payload.get("app", "video"), payload.get("token", ""), "file", cfg)


def _safe_get(url: str) -> str:
    import urllib.request
    return urllib.request.urlopen(url, timeout=8).read().decode("utf-8")
```

> 注意：`status` 里在线自动激活仅当已配置且联网才成功；断网时 `_safe_get` 抛错被 `activate_online` 吞掉，回退本地态。**测试默认不联网**，故 status 返回 licensed=false（无本地记录），符合断言。

- [ ] **Step 4: 注册到 server_app.py**

在 `chayuan/server/api_server/server_app.py` 的路由注册区（与其它 `app.include_router(...)` 并列）加：
```python
from chayuan.server.api_server.license_routes import license_router
# ...在 create app / include 区:
app.include_router(license_router)
```
（按文件现有 import 位置与 include 区落位；与 `kb_router`、`chat_router` 同处。）

- [ ] **Step 5: run + pass** — `cd PKG && PYTHONPATH=. python3 -m pytest tests/server/license/ -q`（全部绿）。

- [ ] **Step 6: 冒烟:确认 server_app 仍能 import**

Run: `cd PKG && PYTHONPATH=. python3 -c "from chayuan.server.api_server.server_app import *; print('app import OK')"`
Expected: 无 import 错误。

- [ ] **Step 7: commit** — `git commit -m "feat(license): /api/v1/license 路由 + 注册 server_app"`

---

## Self-Review

**Spec coverage：** §2 Python 模块(base32/codec/shortcode/token/fingerprint/store)→ Task 1-5 ✓；service(防回拨/激活)→ Task 6 ✓；§3 路由 → Task 8 ✓；§4 偶尔在线自动激活 → Task 6/8 ✓；§5 密钥/配置 → Task 7 ✓。前端改造 = Plan 2/2（另写）。

**Placeholder scan：** server_app.py 注册"按现有 include 区落位"——非占位(给了 import+include 语句,落位是机械步骤)；其余均含完整代码。

**Type consistency：** `verify_shortcode→{valid,reason,fields,expireAt}`、`verify_token→{valid,payload}`、`service.* →{licensed,app,expireAt?,source?,reason?}`、`fingerprint→16hex`、`load_license_config→{hmac_keys,public_key,buy_base_url,products,active_key_id,configured}` 全程一致。to_iso 产出 `...000Z` 与 website/golden 对齐。

**风险点：** to_iso 必须与 JS toISOString 同形(毫秒+Z);activate_token 的 mid 大小写不敏感比较(payload.mid 是 hex 小写)。

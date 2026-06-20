# 网络版席位收费 — Plan 1：服务端校验（chayuan-server）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chayuan-server 实现网络版部署席位授权的判定与拦截：单机版完全短路、网络版默认 10 用户、激活 Ed25519 部署令牌后按 maxUsers 放行，拦在 `create_user`，并暴露 status/activate REST。

**Architecture:** 新增独立模块 `license/seat.py`（指纹 + 部署 license 存取 + `effective_max_users` + 拦截），与现有 per-module 短码 license 零耦合。`create_user` 调用前置守卫。`api_server/license_routes.py` 复用现有 `license_router` 加 `/deployment/*` 两个端点。`is_single_machine()` 为真时全链路短路。

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, cryptography(Ed25519), pytest。

**测试环境（每条 pytest 命令前置）：**
```
export PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server"
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server
# 用 py312（见 memory reference_py312_test_env）
```

---

## 文件结构

- **Create** `chayuan/server/license/seat.py` — 席位授权全部逻辑：部署指纹、`deployment_license.json` 存取、`effective_max_users`、`SeatLimitReached`、`assert_seat_available`、`activate_deployment_token`。单一职责，单机短路。
- **Modify** `chayuan/server/auth/service.py` — `create_user` 在写库前调用 `assert_seat_available()`。
- **Modify** `chayuan/server/api_server/license_routes.py` — 给现有 `license_router` 加 `GET /deployment/status` + `POST /deployment/activate`。
- **Test** `chayuan/../tests/unit_tests/test_seat_core.py`、`test_seat_create_user.py`、`test_seat_activate.py`、`test_seat_routes.py`。

---

## Task 1: seat.py 核心（指纹 + license 存取 + effective_max_users）

**Files:**
- Create: `chayuan/server/license/seat.py`
- Test: `tests/unit_tests/test_seat_core.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_seat_core.py
from __future__ import annotations
import json, time
from pathlib import Path
import pytest
from chayuan.server.license import seat


def test_fingerprint_stable(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    fp1 = seat.deployment_fingerprint(tmp_path)
    fp2 = seat.deployment_fingerprint(tmp_path)
    assert fp1 and fp1 == fp2
    assert (tmp_path / "deployment_id.json").is_file()


def test_single_machine_unlimited(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    assert seat.effective_max_users(tmp_path) is None


def test_network_default_10(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.delenv("CHAYUAN_SEAT_DISABLED", raising=False)
    assert seat.effective_max_users(tmp_path) == 10


def test_network_with_license(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    seat.write_deployment_license(
        tmp_path, {"maxUsers": 100, "expireAt": time.time() + 3600, "fp": "x"}
    )
    assert seat.effective_max_users(tmp_path) == 100


def test_expired_license_falls_back_10(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    seat.write_deployment_license(
        tmp_path, {"maxUsers": 100, "expireAt": time.time() - 1, "fp": "x"}
    )
    assert seat.effective_max_users(tmp_path) == 10


def test_kill_switch_unlimited(tmp_path, monkeypatch):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.setenv("CHAYUAN_SEAT_DISABLED", "1")
    assert seat.effective_max_users(tmp_path) is None
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit_tests/test_seat_core.py -q`
Expected: FAIL（`ModuleNotFoundError: chayuan.server.license.seat`）

- [ ] **Step 3: 写最小实现**

```python
# chayuan/server/license/seat.py
"""网络版部署席位授权。与单机版完全隔离：is_single_machine() 时全部短路。

载体 = website 签发的 Ed25519 令牌（payload {kind:'seat', maxUsers, fp, exp, ...}），
落盘 $CHAYUAN_ROOT/deployment_license.json。与 per-module 短码 license 互不干涉。
"""
from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Optional

from chayuan.server.profiles import is_single_machine

DEFAULT_WEB_MAX_USERS = 10
_DEPLOYMENT_ID_FILE = "deployment_id.json"
_DEPLOYMENT_LICENSE_FILE = "deployment_license.json"


class SeatLimitReached(Exception):
    def __init__(self, used: int, limit: int):
        self.used = used
        self.limit = limit
        super().__init__(f"席位已满（{used}/{limit}），请升级网络版席位或停用旧账号。")


def _seat_disabled() -> bool:
    return os.environ.get("CHAYUAN_SEAT_DISABLED", "").strip().lower() in ("1", "true", "yes")


def deployment_fingerprint(root: Path) -> str:
    """稳定的部署指纹；首次生成并持久化到 deployment_id.json。"""
    p = root / _DEPLOYMENT_ID_FILE
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        fp = str(data.get("fp") or "")
        if fp:
            return fp
    except Exception:
        pass
    fp = secrets.token_hex(16)
    try:
        root.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"fp": fp}), encoding="utf-8")
    except Exception:
        pass
    return fp


def read_deployment_license(root: Path) -> Optional[dict]:
    try:
        data = json.loads((root / _DEPLOYMENT_LICENSE_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_deployment_license(root: Path, data: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / _DEPLOYMENT_LICENSE_FILE).write_text(json.dumps(data), encoding="utf-8")


def _expired(lic: dict, now: Optional[float] = None) -> bool:
    exp = lic.get("expireAt")
    if not exp:
        return True
    now = time.time() if now is None else now
    return float(exp) <= now


def effective_max_users(root: Path, now: Optional[float] = None) -> Optional[int]:
    """None = 无限制。单机短路 + kill-switch 兜底；网络版无 license 回退默认 10。"""
    if _seat_disabled():
        return None
    if is_single_machine():
        return None
    lic = read_deployment_license(root)
    if lic and not _expired(lic, now):
        try:
            return int(lic["maxUsers"])
        except (KeyError, ValueError, TypeError):
            return DEFAULT_WEB_MAX_USERS
    return DEFAULT_WEB_MAX_USERS
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit_tests/test_seat_core.py -q`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/license/seat.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_core.py
sudo git commit -m "feat(license): 网络版部署席位 seat.py 核心(指纹/license存取/effective_max_users)"
```

---

## Task 2: create_user 席位守卫（拦在写路径）

**Files:**
- Modify: `chayuan/server/license/seat.py`（加 `assert_seat_available`）
- Modify: `chayuan/server/auth/service.py:create_user`
- Test: `tests/unit_tests/test_seat_create_user.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_seat_create_user.py
from __future__ import annotations
import pytest
from chayuan.server.auth import service as svc
from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.session import session_scope
from chayuan.server.license import seat


@pytest.fixture(autouse=True)
def _clean_users():
    def _purge():
        with session_scope() as s:
            s.query(UserModel).delete()
    _purge(); yield; _purge()


@pytest.fixture(autouse=True)
def _net_root(tmp_path, monkeypatch):
    # 网络版形态 + CHAYUAN_ROOT 指向 tmp，默认 10
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.delenv("CHAYUAN_SEAT_DISABLED", raising=False)
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    yield


def test_under_cap_allows(tmp_path):
    seat.write_deployment_license(tmp_path, {"maxUsers": 3, "expireAt": 9999999999, "fp": "x"})
    svc.create_user("u1", "secret123", role="admin")
    svc.create_user("u2", "secret123", role="user")
    assert svc.create_user("u3", "secret123", role="user") is not None  # 第3个=上限内


def test_at_cap_raises(tmp_path):
    seat.write_deployment_license(tmp_path, {"maxUsers": 2, "expireAt": 9999999999, "fp": "x"})
    svc.create_user("u1", "secret123", role="admin")
    svc.create_user("u2", "secret123", role="user")
    with pytest.raises(seat.SeatLimitReached):
        svc.create_user("u3", "secret123", role="user")  # 第3个超 2


def test_single_machine_unlimited(monkeypatch):
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    for i in range(15):
        svc.create_user(f"d{i}", "secret123", role="user")  # 单机 15 个不报错
    with session_scope() as s:
        assert s.query(UserModel).count() == 15
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit_tests/test_seat_create_user.py -q`
Expected: FAIL（`AttributeError: module ... has no attribute 'assert_seat_available'` 或第3个未拦报错）

- [ ] **Step 3: 写实现**

在 `seat.py` 末尾追加（计数口径 = users 表总行数含 admin）：

```python
def assert_seat_available(root: Optional[Path] = None) -> None:
    """create_user 写库前调用。网络版达上限抛 SeatLimitReached；单机/未约束 no-op。"""
    if root is None:
        env = os.environ.get("CHAYUAN_ROOT")
        root = Path(env) if env else Path.cwd()
    limit = effective_max_users(root)
    if limit is None:
        return
    from sqlalchemy import func, select
    from chayuan.server.db.models.user_model import UserModel
    from chayuan.server.db.session import session_scope
    with session_scope() as s:
        used = int(s.execute(select(func.count()).select_from(UserModel)).scalar() or 0)
    if used >= limit:
        raise SeatLimitReached(used, limit)
```

在 `auth/service.py` 的 `create_user` 里，**校验通过后、`hash_password` 之前**插入守卫（用 grep 定位 `def create_user` 函数体，紧接现有 role 校验之后）：

```python
    # 网络版席位上限（单机/未约束 no-op；只拦新增、绝不拦登录）
    from chayuan.server.license.seat import assert_seat_available
    assert_seat_available()
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit_tests/test_seat_create_user.py tests/unit_tests/test_admin_setup.py -q`
Expected: PASS（新测试通过 + 旧 admin_setup 不回归）

- [ ] **Step 5: 提交**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/license/seat.py \
  chayuan-server/libs/chayuan-server/chayuan/server/auth/service.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_create_user.py
sudo git commit -m "feat(auth): create_user 席位守卫(网络版总账号上限,单机短路,只拦新增)"
```

> **TOCTOU 备注（R4）**：本守卫"先 count 后 insert"在高并发批量建用户下存在竞态。Plan 后续在网络版（Postgres）落地时，于 `create_user` 事务内加 `SELECT pg_advisory_xact_lock(<常量key>)` 串行化建用户临界区；SQLite（单机）无此函数但单机本就短路、无需。本任务不引入，留作 Postgres 落地子任务。

---

## Task 3: 激活 Ed25519 部署令牌

**Files:**
- Modify: `chayuan/server/license/seat.py`（加 `activate_deployment_token`）
- Test: `tests/unit_tests/test_seat_activate.py`

- [ ] **Step 1: 写失败测试**（用本地生成的 Ed25519 keypair 模拟 website 签发）

```python
# tests/unit_tests/test_seat_activate.py
from __future__ import annotations
import base64, json, time
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from chayuan.server.license import seat


def _sign_token(payload: dict, priv: Ed25519PrivateKey) -> str:
    msg = json.dumps(payload).encode("utf-8")
    sig = priv.sign(msg)
    b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
    return f"{b(msg)}.{b(sig)}"


@pytest.fixture
def keypair():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    return priv, pub


def test_activate_ok(tmp_path, monkeypatch, keypair):
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    priv, pub = keypair
    fp = seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": fp, "exp": time.time() + 3600}, priv
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is True and res["maxUsers"] == 100
    assert seat.effective_max_users(tmp_path) == 100


def test_activate_wrong_fp_rejected(tmp_path, keypair):
    priv, pub = keypair
    seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": "OTHER", "exp": time.time() + 3600}, priv
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is False and res.get("reason") == "fp-mismatch"


def test_activate_expired_rejected(tmp_path, keypair):
    priv, pub = keypair
    fp = seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": fp, "exp": time.time() - 1}, priv
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is False and res.get("reason") == "expired"


def test_activate_bad_signature_rejected(tmp_path, keypair):
    priv, pub = keypair
    other = Ed25519PrivateKey.generate()
    fp = seat.deployment_fingerprint(tmp_path)
    token = _sign_token(
        {"kind": "seat", "maxUsers": 100, "fp": fp, "exp": time.time() + 3600}, other
    )
    res = seat.activate_deployment_token(tmp_path, token, public_key=pub)
    assert res["ok"] is False and res.get("reason") == "bad-signature"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit_tests/test_seat_activate.py -q`
Expected: FAIL（`AttributeError: ... 'activate_deployment_token'`）

- [ ] **Step 3: 写实现**（追加到 `seat.py`，复用现有 `token.verify_token`）

```python
def activate_deployment_token(root: Path, token: str, public_key: bytes,
                              now: Optional[float] = None) -> dict:
    """离线验签部署令牌并落盘。失败返回 {ok:False, reason}。"""
    from chayuan.server.license.token import verify_token
    r = verify_token(token, public_key)
    if not r.get("valid"):
        return {"ok": False, "reason": "bad-signature"}
    p = r.get("payload") or {}
    if p.get("kind") != "seat":
        return {"ok": False, "reason": "not-seat"}
    if str(p.get("fp") or "") != deployment_fingerprint(root):
        return {"ok": False, "reason": "fp-mismatch"}
    now = time.time() if now is None else now
    exp = p.get("exp")
    if not exp or float(exp) <= now:
        return {"ok": False, "reason": "expired"}
    try:
        max_users = int(p["maxUsers"])
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "reason": "bad-payload"}
    write_deployment_license(root, {
        "maxUsers": max_users, "expireAt": float(exp),
        "fp": p["fp"], "token": token, "activatedAt": now,
    })
    return {"ok": True, "maxUsers": max_users, "expireAt": float(exp)}
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit_tests/test_seat_activate.py -q`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/license/seat.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_activate.py
sudo git commit -m "feat(license): 部署令牌离线激活(Ed25519 verify_token + fp/exp 校验)"
```

---

## Task 4: REST 端点 /deployment/status + /deployment/activate

**Files:**
- Modify: `chayuan/server/api_server/license_routes.py`
- Test: `tests/unit_tests/test_seat_routes.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_seat_routes.py
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.license_routes import license_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    monkeypatch.delenv("CHAYUAN_SEAT_DISABLED", raising=False)
    app = FastAPI()
    app.include_router(license_router)
    return TestClient(app)


def test_status_network_default(client):
    r = client.get("/api/v1/license/deployment/status")
    assert r.status_code == 200
    b = r.json()
    assert b["maxUsers"] == 10 and b["edition"] == "web" and "fingerprint" in b


def test_status_single_machine_unlimited(client, monkeypatch):
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    b = client.get("/api/v1/license/deployment/status").json()
    assert b["maxUsers"] is None and b["edition"] == "desktop"


def test_activate_bad_token(client):
    r = client.post("/api/v1/license/deployment/activate", json={"token": "garbage"})
    assert r.status_code == 200 and r.json()["ok"] is False
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit_tests/test_seat_routes.py -q`
Expected: FAIL（404，端点未定义）

- [ ] **Step 3: 写实现**（在 `license_routes.py` 末尾，给现有 `license_router` 追加）

```python
from chayuan.server.license import seat as _seat


@license_router.get("/deployment/status")
def get_deployment_status():
    root = _root()
    max_users = _seat.effective_max_users(root)
    used = 0
    if max_users is not None:
        from sqlalchemy import func, select
        from chayuan.server.db.models.user_model import UserModel
        from chayuan.server.db.session import session_scope
        with session_scope() as s:
            used = int(s.execute(select(func.count()).select_from(UserModel)).scalar() or 0)
    lic = _seat.read_deployment_license(root) or {}
    return {
        "edition": "desktop" if max_users is None and _seat.is_single_machine() else "web",
        "maxUsers": max_users,
        "usedUsers": used,
        "available": None if max_users is None else max(0, max_users - used),
        "expireAt": lic.get("expireAt"),
        "fingerprint": _seat.deployment_fingerprint(root),
    }


@license_router.post("/deployment/activate")
def post_deployment_activate(token: str = Body(..., embed=True)):
    if _seat.is_single_machine():
        return {"ok": False, "reason": "not-applicable-single-machine"}
    cfg = load_license_config()
    with _mutate_lock:
        return _seat.activate_deployment_token(_root(), token, cfg["public_key"])
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit_tests/test_seat_routes.py -q`
Expected: PASS（3 passed）

- [ ] **Step 5: 全量回归 + 提交**

```bash
pytest tests/unit_tests/test_seat_core.py tests/unit_tests/test_seat_create_user.py \
  tests/unit_tests/test_seat_activate.py tests/unit_tests/test_seat_routes.py \
  tests/unit_tests/test_admin_setup.py -q
# 全绿后：
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/license_routes.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_routes.py
sudo git commit -m "feat(api): /deployment/status + /deployment/activate 席位端点(单机短路)"
```

---

## 自检（写完计划后）

1. **Spec 覆盖**：§3.1 指纹→Task1；§3.2 effective_max_users→Task1；§3.3 create_user 拦截+计数口径→Task2；§3.4 TOCTOU→Task2 备注（Postgres 子任务）；§3.5 两端点→Task3+Task4；§2 license 存取→Task1。前端(§5)/发码(§4)= Plan 2/3，不在本计划。
2. **占位符**：无 TBD/TODO，所有 step 含真实代码/命令。
3. **类型一致**：`effective_max_users`/`assert_seat_available`/`activate_deployment_token`/`SeatLimitReached`/`deployment_fingerprint`/`read|write_deployment_license` 在各 Task 命名一致；端点用现有 `license_router`/`_root`/`_mutate_lock`/`load_license_config`。

## 执行约束（务必遵守）

- 本仓 root 所有：git 操作要 `sudo`，只 stage 改的文件（见 memory: commit-procedure-chayuan-desktop）。
- 改了程序代码 → commit 时 bump 版本（VERSION + 3 tauri.conf + libs pyproject，见 memory: feedback_version_bump_on_commit）。本计划每个 Task 末尾的 commit 可在最后一个 Task 统一 bump 一次。
- **绝不**在 login/鉴权中间件加席位检查；只在 `create_user`。

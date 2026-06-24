# 服务版部署指纹 DB 化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把网络版「部署指纹 + 已激活席位令牌」从本地 JSON 文件搬到共享 DB 单例表 `deployment_identity`,多节点读同一份;单机版保持文件逻辑零变化;迁移导入老文件保已购令牌不失效。

**Architecture:** 新建 `DeploymentIdentityModel` 单例表(key='deployment')+ alembic 0025。新增 `license/seat_store.py` 封装 DB 读写 + 首次访问从旧文件迁移导入 + 多节点 insert-or-get 竞态。`seat.py` 的 `deployment_fingerprint/read_deployment_license/write_deployment_license` 改为:`is_single_machine()` 时走原文件逻辑,网络版委托 `seat_store`。函数签名不变,`license_routes.py`/`auth/service.py` 调用方零改动。前端 / website 零改动(已核实)。

**Tech Stack:** Python, SQLAlchemy(declarative Base), Alembic, FastAPI, pytest。py311 本机可跑测试。

**测试与环境:**
- 测试:`PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server pytest -q <file>`(py311;若 `python` 太旧用 `python3.11 -m pytest`)。
- 仓库 root 拥有:写/改文件用 `sudo`(写 scratchpad 临时文件 → `sudo cp` 覆盖,或 `sudo python3` 精确替换);提交用 `sudo git`(仓库根 /work/chayuan-desktop,分支 main)。
- py_compile:`python3.11 -m py_compile <files>`。

---

## 文件结构

```
新增  chayuan/server/db/models/deployment_identity_model.py   单例表 ORM
改动  chayuan/server/db/models/__init__.py                    注册触发 create_all
新增  chayuan/server/db/alembic/versions/0025_deployment_identity.py  建表迁移
新增  chayuan/server/license/seat_store.py                    DB 读写 + 迁移导入 + 竞态
改动  chayuan/server/license/seat.py                           三函数改 单机文件/网络DB 分流
新增  tests/unit_tests/test_seat_store.py                      seat_store 单测
改动  tests/unit_tests/test_seat_*.py(如需)                   现有席位测试沿用(应自然通过)
```
(路径相对 `/work/chayuan-desktop/chayuan-server/libs/chayuan-server/`)

---

### Task 1: DeploymentIdentityModel 表 + 注册 + alembic 迁移

**Files:**
- Create: `chayuan/server/db/models/deployment_identity_model.py`
- Modify: `chayuan/server/db/models/__init__.py`
- Create: `chayuan/server/db/alembic/versions/0025_deployment_identity.py`
- Test: `tests/unit_tests/test_seat_store.py`(本任务先放一个建表/round-trip 冒烟)

- [ ] **Step 1: 写 model 文件**(sudo 写入)

`chayuan/server/db/models/deployment_identity_model.py`:
```python
"""deployment_identity 单例表:网络版部署身份(部署指纹 + 已激活席位令牌)的共享真源。

整部署一行(key 固定 'deployment'),所有节点读同一份 → 多节点席位授权一致。
单机版不使用此表(seat.py 单机走本地文件)。
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, String, Text, func

from chayuan.server.db.base import Base


class DeploymentIdentityModel(Base):
    __tablename__ = "deployment_identity"

    key = Column(String(32), primary_key=True)          # 固定常量 'deployment',保证单例
    fingerprint = Column(String(128), nullable=False)   # 部署指纹(opaque hex)
    license_json = Column(Text, nullable=True)          # 已激活席位令牌 dict 的 JSON;未激活为 NULL
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 2: 在 models/__init__.py 注册**(触发 create_all 看到此表)

在 `chayuan/server/db/models/__init__.py` 末尾(与既有 `from chayuan.server.db.models import role_model  # noqa: F401` 同风格)加一行:
```python
from chayuan.server.db.models import deployment_identity_model  # noqa: F401
```

- [ ] **Step 3: 写 alembic 迁移**(参考 0024_roles.py)

`chayuan/server/db/alembic/versions/0025_deployment_identity.py`:
```python
"""deployment_identity 单例表(网络版部署身份 DB 化 #fp)。

新增 deployment_identity 表(key PK / fingerprint / license_json / updated_at)。
表已存在(create_all 模式先建过)则跳过 —— 两种建表模式都安全。本迁移**不**导入旧本地文件,
文件迁移由 seat_store 运行时首次访问完成(覆盖 alembic / create_all 两种启动路径)。

Revision ID: 0025_deployment_identity
Revises: 0024_roles
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0025_deployment_identity"
down_revision = "0024_roles"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table("deployment_identity"):
        op.create_table(
            "deployment_identity",
            sa.Column("key", sa.String(length=32), nullable=False),
            sa.Column("fingerprint", sa.String(length=128), nullable=False),
            sa.Column("license_json", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("key"),
        )


def downgrade() -> None:
    if _has_table("deployment_identity"):
        op.drop_table("deployment_identity")
```

> 注:确认 `down_revision` 是当前 head。实施前跑 `ls chayuan/server/db/alembic/versions/ | sort | tail -3` 确认最新是 0024_roles;若已有更高编号,把 revision 编号顺延、down_revision 指向真实 head。

- [ ] **Step 4: 冒烟测试 round-trip**(本任务先建 test 文件,放一个建表/读写测试)

`tests/unit_tests/test_seat_store.py`:
```python
from __future__ import annotations

import pytest

from chayuan.server.db.session import session_scope
from chayuan.server.db.models.deployment_identity_model import DeploymentIdentityModel


@pytest.fixture(autouse=True)
def _clean_row():
    def _purge():
        with session_scope() as s:
            s.query(DeploymentIdentityModel).delete()
    _purge(); yield; _purge()


def test_model_roundtrip():
    with session_scope() as s:
        s.add(DeploymentIdentityModel(key="deployment", fingerprint="abc123", license_json=None))
    with session_scope() as s:
        row = s.get(DeploymentIdentityModel, "deployment")
        assert row is not None and row.fingerprint == "abc123"
```

- [ ] **Step 5: 跑测试(应 PASS,证明表已被 conftest create_all 建出)**

Run: `PYTHONPATH=$PWD python3.11 -m pytest -q tests/unit_tests/test_seat_store.py`
Expected: 1 passed。若报「no such table: deployment_identity」→ 说明 conftest 用的不是 create_all 也没跑 0025 迁移,需在 Step 2 注册基础上确认 conftest 建表方式(大概率 create_all,注册即可)。

- [ ] **Step 6: py_compile + 提交**

```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && python3.11 -m py_compile chayuan/server/db/models/deployment_identity_model.py chayuan/server/db/alembic/versions/0025_deployment_identity.py
cd /work/chayuan-desktop
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/db/models/deployment_identity_model.py chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py chayuan-server/libs/chayuan-server/chayuan/server/db/alembic/versions/0025_deployment_identity.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_store.py
sudo git commit -m "feat(license): deployment_identity 单例表 + 0025 迁移(部署身份 DB 化骨架)"
sudo git push origin main
```

---

### Task 2: seat_store.py —— DB 读写 + 迁移导入 + 竞态

**Files:**
- Create: `chayuan/server/license/seat_store.py`
- Test: `tests/unit_tests/test_seat_store.py`(在 Task1 文件上追加)

- [ ] **Step 1: 写 seat_store.py**(sudo 写入)

`chayuan/server/license/seat_store.py`:
```python
"""网络版部署身份的 DB 持久层(deployment_identity 单例表)。

- 真源在 DB:多节点读同一行。
- 首次访问若 DB 无行:从旧本地文件(deployment_id.json / deployment_license.json)迁移导入,
  保已购令牌不失效;无文件则新生成 token_hex(16)。
- 多节点并发初始化:key 唯一主键 + insert-or-get(IntegrityError 容错)。
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Optional, Tuple

from sqlalchemy.exc import IntegrityError

from chayuan.server.db.session import session_scope
from chayuan.server.db.models.deployment_identity_model import DeploymentIdentityModel

_KEY = "deployment"
_DEPLOYMENT_ID_FILE = "deployment_id.json"
_DEPLOYMENT_LICENSE_FILE = "deployment_license.json"


def _migrate_from_files(root: Path) -> Tuple[str, Optional[str]]:
    """首次建行的初值:优先导入旧文件 fp(保已购令牌),否则新生成;license 同理。"""
    fp = ""
    try:
        data = json.loads((root / _DEPLOYMENT_ID_FILE).read_text(encoding="utf-8"))
        fp = str(data.get("fp") or "")
    except Exception:
        fp = ""
    if not fp:
        fp = secrets.token_hex(16)
    lic_json: Optional[str] = None
    try:
        lic = json.loads((root / _DEPLOYMENT_LICENSE_FILE).read_text(encoding="utf-8"))
        if isinstance(lic, dict):
            lic_json = json.dumps(lic)
    except Exception:
        lic_json = None
    return fp, lic_json


def _ensure_row(root: Path) -> None:
    with session_scope() as s:
        if s.get(DeploymentIdentityModel, _KEY) is not None:
            return
    fp, lic_json = _migrate_from_files(root)
    try:
        with session_scope() as s:
            s.add(DeploymentIdentityModel(key=_KEY, fingerprint=fp, license_json=lic_json))
    except IntegrityError:
        # 多节点竞态:另一副本已插入 → 忽略,后续读既有行
        pass


def get_fingerprint(root: Path) -> str:
    _ensure_row(root)
    with session_scope() as s:
        row = s.get(DeploymentIdentityModel, _KEY)
        return row.fingerprint if row else ""


def read_license(root: Path) -> Optional[dict]:
    _ensure_row(root)
    with session_scope() as s:
        row = s.get(DeploymentIdentityModel, _KEY)
        if not row or not row.license_json:
            return None
        try:
            data = json.loads(row.license_json)
            return data if isinstance(data, dict) else None
        except Exception:
            return None


def write_license(root: Path, data: dict) -> None:
    _ensure_row(root)
    with session_scope() as s:
        row = s.get(DeploymentIdentityModel, _KEY)
        if row is None:  # 极端竞态兜底
            row = DeploymentIdentityModel(key=_KEY, fingerprint=secrets.token_hex(16))
            s.add(row)
        row.license_json = json.dumps(data)
```

- [ ] **Step 2: 写失败测试(迁移导入 + 竞态 + round-trip)**

在 `tests/unit_tests/test_seat_store.py` 追加(import 顶部加 `from pathlib import Path` 与 `from chayuan.server.license import seat_store`):
```python
def test_fresh_init_generates_stable_fp(tmp_path):
    fp1 = seat_store.get_fingerprint(tmp_path)
    fp2 = seat_store.get_fingerprint(tmp_path)
    assert fp1 and fp1 == fp2           # 稳定,不每次重生成
    assert len(fp1) == 32               # token_hex(16)

def test_migrate_imports_old_id_file(tmp_path):
    import json
    (tmp_path / "deployment_id.json").write_text(json.dumps({"fp": "deadbeef" * 4}), encoding="utf-8")
    assert seat_store.get_fingerprint(tmp_path) == "deadbeef" * 4   # 老指纹被导入,不新生成

def test_migrate_imports_old_license_file(tmp_path):
    import json
    (tmp_path / "deployment_id.json").write_text(json.dumps({"fp": "ab" * 16}), encoding="utf-8")
    (tmp_path / "deployment_license.json").write_text(
        json.dumps({"maxUsers": 7, "expireAt": 9999999999, "fp": "ab" * 16}), encoding="utf-8")
    lic = seat_store.read_license(tmp_path)
    assert lic and lic["maxUsers"] == 7

def test_write_then_read_license(tmp_path):
    seat_store.write_license(tmp_path, {"maxUsers": 5, "expireAt": 9999999999, "fp": "x"})
    lic = seat_store.read_license(tmp_path)
    assert lic and lic["maxUsers"] == 5

def test_idempotent_does_not_overwrite(tmp_path):
    fp1 = seat_store.get_fingerprint(tmp_path)
    seat_store.get_fingerprint(tmp_path)          # 第二次不应新建/改值
    with session_scope() as s:
        assert s.query(DeploymentIdentityModel).count() == 1
        assert s.get(DeploymentIdentityModel, "deployment").fingerprint == fp1
```

- [ ] **Step 3: 跑测试**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=$PWD python3.11 -m pytest -q tests/unit_tests/test_seat_store.py`
Expected: 全部 PASS(含 Task1 的 round-trip,合计 6 passed)。

- [ ] **Step 4: py_compile + 提交**

```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && python3.11 -m py_compile chayuan/server/license/seat_store.py
cd /work/chayuan-desktop
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/license/seat_store.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_store.py
sudo git commit -m "feat(license): seat_store DB 读写 + 旧文件迁移导入 + insert-or-get 竞态"
sudo git push origin main
```

---

### Task 3: seat.py 三函数改「单机文件 / 网络 DB」分流

**Files:**
- Modify: `chayuan/server/license/seat.py`
- Test: `tests/unit_tests/test_seat_store.py`(追加单机走文件的回归)

- [ ] **Step 1: 把现有文件实现改名为私有 helper,公开三函数改分流**

在 `seat.py` 中:把现有 `deployment_fingerprint` / `read_deployment_license` / `write_deployment_license` 的**函数体**抽成私有 `_file_*`,公开同名函数按 `is_single_machine()` 分流。具体替换:

把:
```python
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
```
替换为:
```python
def _file_deployment_fingerprint(root: Path) -> str:
    """单机版:部署指纹存本地 deployment_id.json(原逻辑,保桌面零变化)。"""
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


def _file_read_license(root: Path) -> Optional[dict]:
    try:
        data = json.loads((root / _DEPLOYMENT_LICENSE_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _file_write_license(root: Path, data: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / _DEPLOYMENT_LICENSE_FILE).write_text(json.dumps(data), encoding="utf-8")


def deployment_fingerprint(root: Path) -> str:
    """部署指纹。单机→本地文件;网络版→共享 DB(seat_store,多节点一致)。"""
    if is_single_machine():
        return _file_deployment_fingerprint(root)
    from chayuan.server.license import seat_store
    return seat_store.get_fingerprint(root)


def read_deployment_license(root: Path) -> Optional[dict]:
    if is_single_machine():
        return _file_read_license(root)
    from chayuan.server.license import seat_store
    return seat_store.read_license(root)


def write_deployment_license(root: Path, data: dict) -> None:
    if is_single_machine():
        _file_write_license(root, data)
        return
    from chayuan.server.license import seat_store
    seat_store.write_license(root, data)
```

(`effective_max_users` / `assert_seat_available` / `activate_*` / `_looks_like_shortcode` / 常量 `_DEPLOYMENT_ID_FILE`、`_DEPLOYMENT_LICENSE_FILE` 全部保留不动 —— 它们继续调用上面三个公开函数,行为透明切换。)

- [ ] **Step 2: 写回归测试(单机走文件、不碰表)**

在 `tests/unit_tests/test_seat_store.py` 追加:
```python
def test_single_machine_uses_file_not_db(tmp_path, monkeypatch):
    from chayuan.server.license import seat
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    fp = seat.deployment_fingerprint(tmp_path)
    assert fp and len(fp) == 32
    assert (tmp_path / "deployment_id.json").exists()        # 单机写了文件
    with session_scope() as s:                               # 单机没碰 DB 表
        assert s.query(DeploymentIdentityModel).count() == 0

def test_network_uses_db_not_file(tmp_path, monkeypatch):
    from chayuan.server.license import seat
    monkeypatch.delenv("CHAYUAN_PROFILE", raising=False)
    fp = seat.deployment_fingerprint(tmp_path)
    assert fp
    assert not (tmp_path / "deployment_id.json").exists()    # 网络版不写文件
    with session_scope() as s:
        assert s.query(DeploymentIdentityModel).count() == 1
```

- [ ] **Step 3: 跑 seat 全套(新 + 旧)**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=$PWD python3.11 -m pytest -q tests/unit_tests/test_seat_store.py tests/unit_tests/test_seat_core.py tests/unit_tests/test_seat_create_user.py tests/unit_tests/test_seat_activate.py`
Expected: 全 PASS。
说明:`test_seat_create_user.py` 的网络用例(`_net_root` 删 CHAYUAN_PROFILE)现在走 DB 路径——它调 `seat.write_deployment_license(tmp_path, {...})` 写 DB、`effective_max_users` 读 DB,语义不变应自然通过。**若**这些旧测试因「网络模式下 deployment_identity 行残留跨用例污染」失败,在 `tests/unit_tests/test_seat_create_user.py` 的 autouse fixture 里补一段清表(与 test_seat_store 的 `_clean_row` 同款),把 DeploymentIdentityModel 行也清掉。

- [ ] **Step 4: py_compile + 提交**

```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && python3.11 -m py_compile chayuan/server/license/seat.py
cd /work/chayuan-desktop
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/license/seat.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_seat_store.py
# 若改了 test_seat_create_user.py 也一并 add
sudo git commit -m "feat(license): 部署指纹/许可 单机走文件、网络版走 DB(seat_store)分流"
sudo git push origin main
```

---

### Task 4: 全量验证 + 版本 bump + 推送

- [ ] **Step 1: 跑 license/seat 相关全量测试**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=$PWD python3.11 -m pytest -q tests/unit_tests/test_seat_store.py tests/unit_tests/test_seat_core.py tests/unit_tests/test_seat_create_user.py tests/unit_tests/test_seat_activate.py`
Expected: 全 PASS。记录 passed 数。

- [ ] **Step 2: py_compile 全部改动 .py**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && python3.11 -m py_compile chayuan/server/db/models/deployment_identity_model.py chayuan/server/db/alembic/versions/0025_deployment_identity.py chayuan/server/license/seat_store.py chayuan/server/license/seat.py`
Expected: 无输出(成功)。

- [ ] **Step 3: bump 版本 + 提交推送**

```bash
cd /work/chayuan-desktop
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/chayuan/__init__.py chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json
sudo git commit -m "chore(release): bump 版本(部署指纹 DB 化)"
sudo git push origin main
```

- [ ] **Step 4: 收尾说明**

汇总:改动文件、测试 passed 数、迁移导入与多节点一致性如何验证。提醒:docker 网络版需重建镜像;真机首次启动会跑 0025 迁移建表 + seat_store 首访迁移导入老 deployment_id.json。

---

## Self-Review

- **Spec 覆盖**:§3 表=Task1;§5 seat 改造=Task3;§6 迁移导入+竞态=Task2(_migrate_from_files / insert-or-get)+ Task1(0025);§4 值口径(token_hex16 不变)=Task2 `_migrate_from_files`;§7 单机短路=Task3 分流 + test_single_machine_uses_file_not_db;§8 测试=Task1/2/3 各测 + Task4 全量。前端/website 零改动=无任务(已核实)。无缺口。
- **占位扫描**:无 TBD/TODO;每个代码步给完整代码或精确 old→new;测试均含真实断言。
- **类型一致**:`seat_store.get_fingerprint/read_license/write_license(root)` 在 Task2 定义、Task3 调用一致;`DeploymentIdentityModel(key/fingerprint/license_json/updated_at)` 在 Task1 定义,Task2/3 测试用同字段名;seat.py 公开三函数签名与原一致(`deployment_fingerprint(root)`、`read_deployment_license(root)`、`write_deployment_license(root,data)`),调用方零改。
- **风险**:旧 `test_seat_create_user.py` 网络用例转走 DB,已在 Task3 Step3 给出「若跨用例污染则补清表」的兜底指引。`down_revision` 需实施前核对真实 head(Task1 Step3 已注明)。

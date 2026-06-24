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

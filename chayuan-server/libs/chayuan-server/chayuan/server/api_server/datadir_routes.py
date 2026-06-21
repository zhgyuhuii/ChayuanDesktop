"""数据目录(CHAYUAN_ROOT)配置 admin REST(P7)。展示当前根目录 + 派生路径 + 诊断,
并支持写 shell rc(export CHAYUAN_ROOT)。

⚠️ 容器(docker)里 CHAYUAN_ROOT 由 compose/env 决定,改 shell rc 对运行中的容器**无效** —
前端会据 in_container 标注。改后需新开 shell / 重启进程才生效。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends

from chayuan.server.auth.deps import require_role

datadir_router = APIRouter(prefix="/api/v1/admin/datadir", tags=["admin-datadir"])
_ADMIN = require_role("admin")

_DEFAULT_RC = {
    "zsh": "~/.zshrc",
    "bash": "~/.bashrc",
    "fish": "~/.config/fish/config.fish",
    "sh": "~/.profile",
}


@datadir_router.get("/info", summary="[admin] 当前数据目录 + 派生路径 + 诊断")
def datadir_info(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.settings import CHAYUAN_ROOT
    from chayuan.paths import resolve_chayuan_root, read_user_state

    info = resolve_chayuan_root()
    root = Path(str(CHAYUAN_ROOT))
    derived = {
        "data": str(root / "data"),
        "logs": str(root / "logs"),
        "knowledge_base": str(root / "data" / "knowledge_base"),
        "models": str(root / "models"),
        "compose": str(root / "compose"),
    }
    try:
        user_state = read_user_state() or {}
    except Exception:  # noqa: BLE001
        user_state = {}
    in_container = os.path.exists("/.dockerenv") or bool(os.environ.get("CHAYUAN_PROFILE"))
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "current_root": str(CHAYUAN_ROOT),
            "source": getattr(info, "source", ""),
            "reason": getattr(info, "reason", ""),
            "env_value": os.environ.get("CHAYUAN_ROOT") or "",
            "derived": derived,
            "user_state": user_state,
            "in_container": in_container,
            "default_rc": _DEFAULT_RC,
        },
    }


@datadir_router.post("/write-rc", summary="[admin] 写 export CHAYUAN_ROOT 到 shell rc(容器内无效)")
def datadir_write_rc(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.dashboard import _upsert_export_line

    new_root = (body.get("new_root") or "").strip()
    shell = (body.get("shell") or "bash").strip()
    rc_path_raw = (body.get("rc_path") or _DEFAULT_RC.get(shell, "~/.profile")).strip()
    if not new_root:
        return {"code": 1, "msg": "new_root 必填", "data": {}}
    rc_path = Path(os.path.expanduser(rc_path_raw))
    try:
        changed, action = _upsert_export_line(rc_path, "CHAYUAN_ROOT", new_root, shell)
    except Exception as e:  # noqa: BLE001
        return {"code": 1, "msg": f"写入失败：{e}", "data": {}}
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "changed": changed,
            "action": action,
            "rc_path": str(rc_path),
            "note": "需新开终端 / source rc / 重启进程才生效;运行中的服务不会自动跟随。",
        },
    }

"""首启设置向导完成状态读写(D1)。

网络版后台首启展示一次性「设置向导」,直到管理员完成/跳过。本模块把该 completed
标记持久化为 CHAYUAN_ROOT 下一个小 json(wizard_state.json),并暴露给前端读写。

「受管部署」(网络版,或单机内核但已注册真实 admin 的网页管理小型部署)才展示向导;
桌面匿名单机应用(单机内核 + 无真实 admin)有自己的 FirstRunSetup,后台向导对它
永不展示——见 _managed()。本模块纯属新增,不改任何既有行为。
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException

from chayuan.server.auth.deps import require_role
from chayuan.server.profiles.bootstrap import is_single_machine
from chayuan.settings import CHAYUAN_ROOT

logger = logging.getLogger(__name__)

wizard_router = APIRouter(prefix="/api/v1/admin/wizard", tags=["admin-wizard"])
_ADMIN = require_role("admin")


def _state_path() -> Path:
    """向导状态文件路径:<CHAYUAN_ROOT>/wizard_state.json。"""
    return CHAYUAN_ROOT / "wizard_state.json"


def _has_real_admin() -> bool:
    """是否已注册真实 admin 账户。

    桌面单机版用固定匿名 ``LocalUser``(role=owner),从不写真实 admin 行 → False;
    网页管理版(含单机内核但开了真实鉴权的小型部署)注册首个管理员后 → True。
    DB 不可用时保守按 False 处理(宁可不弹,不误弹)。
    """
    try:
        from chayuan.server.auth import service as svc
        return bool(svc.admin_exists())
    except Exception as e:  # noqa: BLE001
        logger.debug("[wizard] admin_exists 检查失败,按无 admin 处理: %r", e)
        return False


def _managed() -> bool:
    """是否「受管部署」——需要展示/持久化配置向导。

    判据 = 网络版,**或** 单机内核但已注册真实 admin(如 ``docker-compose.single.yaml``
    起的、初始无 Redis/Milvus/外置 DB、靠向导把基础设施配起来的网页管理小型部署)。

    唯一**不**受管的形态 = 桌面匿名单机应用(单机内核 + 无真实 admin):它有自己的
    首次运行向导(FirstRunSetup),后台向导对它永不展示、永不落盘。
    """
    return (not is_single_machine()) or _has_real_admin()


def _read_state() -> Dict[str, Any]:
    """读取并解析向导状态。文件缺失或解析失败时返回 {"completed": False}。

    缺失文件属正常(首次未写过),不告警;解析失败(文件损坏)告警一次。
    """
    path = _state_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"completed": False}
    except OSError as e:  # noqa: BLE001 — 读盘异常(权限等)按未完成处理
        logger.warning("[wizard] 读取状态文件失败 %s: %r", path, e)
        return {"completed": False}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError) as e:
        logger.warning("[wizard] 状态文件解析失败 %s: %r", path, e)
        return {"completed": False}
    if not isinstance(data, dict):
        return {"completed": False}
    return {"completed": bool(data.get("completed", False))}


def _write_state(state: Dict[str, Any]) -> None:
    """原子写入向导状态:写唯一临时文件 → fsync → os.replace 覆盖,避免写一半被读到。

    非受管形态(桌面匿名单机)向导永不展示,直接 no-op,不落生这个用不到的文件。
    用 tempfile.mkstemp(dir=父目录)保证临时文件与目标同盘(os.replace 才原子)且名字
    唯一(多 worker 并发写不会撞同一 .tmp);失败时 finally 清掉孤儿临时文件。
    """
    if not _managed():
        return
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"completed": bool(state.get("completed", False))}
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)  # 原子替换
        tmp = None             # 已替换,无需清理
    finally:
        if tmp is not None and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def _effective_state() -> Dict[str, Any]:
    """对外生效状态:非受管形态(桌面匿名单机)向导永不展示,直接返回 completed=True
    (不读盘);受管部署(网络版,或单机内核 + 真实 admin)读真实落盘状态。"""
    if not _managed():
        return {"completed": True}
    return _read_state()


@wizard_router.get("/state", summary="[admin] 读取首启设置向导完成状态")
def wizard_get_state(_=Depends(_ADMIN)) -> Dict[str, Any]:
    return {"code": 0, "msg": "ok", "data": _effective_state()}


@wizard_router.post("/state", summary="[admin] 写入首启设置向导完成状态")
def wizard_set_state(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    completed = body.get("completed")
    if not isinstance(completed, bool):
        raise HTTPException(status_code=400, detail="completed 必须为布尔值")
    # 非受管(桌面匿名单机)_write_state 直接 no-op;_effective_state 仍恒返回 completed=True。
    _write_state({"completed": completed})
    return {"code": 0, "msg": "ok", "data": _effective_state()}

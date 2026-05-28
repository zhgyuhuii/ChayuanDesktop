"""vg_materials CRUD。

素材库一条 row 对应磁盘上一份视频/图像文件(本地上传 / Pexels 下载缓
存 / Pixabay 下载缓存 / vendor bundled 出厂内置)。

owner_id 语义:
- NULL  → 全局可见(bundled 内置 + 未登录单机模式上传)
- 非 NULL → 用户私有,list 时按 owner_id + NULL 联合查("我的素材+共享")
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from chayuan.server.db.models.video_generation_model import VgMaterialModel
from chayuan.server.db.session import with_session

logger = logging.getLogger("chayuan.video_generation.store.materials")


def _row_to_dict(row: VgMaterialModel) -> Dict[str, Any]:
    try:
        tags = json.loads(row.tags_json) if row.tags_json else []
    except (TypeError, ValueError):
        tags = []
    return {
        "material_id": row.material_id,
        "owner_id": row.owner_id,
        "source": row.source,
        "name": row.name,
        "path": row.path,
        "mime": row.mime,
        "size": row.size,
        "duration_ms": row.duration_ms,
        "width": row.width,
        "height": row.height,
        "thumbnail_path": row.thumbnail_path,
        "tags": tags,
        "used_count": row.used_count,
        "created_at": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


@with_session
def create_material(
    session: Session,
    *,
    source: str,
    name: str,
    path: str,
    owner_id: Optional[int] = None,
    mime: str = "",
    size: int = 0,
    duration_ms: int = 0,
    width: int = 0,
    height: int = 0,
    thumbnail_path: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    material_id = str(uuid.uuid4())
    row = VgMaterialModel(
        material_id=material_id,
        owner_id=owner_id,
        source=source,
        name=name,
        path=path,
        mime=mime,
        size=size,
        duration_ms=duration_ms,
        width=width,
        height=height,
        thumbnail_path=thumbnail_path,
        tags_json=json.dumps(tags or [], ensure_ascii=False),
        used_count=0,
    )
    session.add(row)
    session.flush()
    logger.info(
        "[vg_materials] create %s name=%r source=%s owner=%s",
        material_id, name, source, owner_id,
    )
    return _row_to_dict(row)


@with_session
def get_material(
    session: Session, material_id: str, *, owner_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """读一条;owner_id 传入时校验归属(允许命中 NULL=共享 row)。"""

    q = session.query(VgMaterialModel).filter(VgMaterialModel.material_id == material_id)
    if owner_id is not None:
        q = q.filter(
            or_(
                VgMaterialModel.owner_id == owner_id,
                VgMaterialModel.owner_id.is_(None),
            )
        )
    row = q.one_or_none()
    return _row_to_dict(row) if row else None


@with_session
def list_materials(
    session: Session,
    *,
    owner_id: Optional[int] = None,
    source: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[Dict[str, Any]], int]:
    """列素材;默认含全局(owner_id=NULL)bundled,跟用户私有合并视图。"""

    page = max(page, 1)
    page_size = max(min(page_size, 200), 1)
    q = session.query(VgMaterialModel)
    if owner_id is not None:
        q = q.filter(
            or_(
                VgMaterialModel.owner_id == owner_id,
                VgMaterialModel.owner_id.is_(None),
            )
        )
    if source:
        q = q.filter(VgMaterialModel.source == source)
    total = q.count()
    rows = (
        q.order_by(desc(VgMaterialModel.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_row_to_dict(r) for r in rows], total


@with_session
def increment_used_count(session: Session, material_ids: List[str]) -> int:
    """task 完成时累加 used_count。返回成功累加的行数。"""

    if not material_ids:
        return 0
    n = (
        session.query(VgMaterialModel)
        .filter(VgMaterialModel.material_id.in_(material_ids))
        .update(
            {VgMaterialModel.used_count: VgMaterialModel.used_count + 1},
            synchronize_session=False,
        )
    )
    return int(n)


@with_session
def delete_material(
    session: Session, material_id: str, *, owner_id: Optional[int] = None,
) -> bool:
    """删素材 row;磁盘文件由 caller 单独清。

    owner_id 传入时只允许删自己的(NULL=共享不可删,需要 admin 权限走另一
    条路径)。
    """

    q = session.query(VgMaterialModel).filter(VgMaterialModel.material_id == material_id)
    if owner_id is not None:
        q = q.filter(VgMaterialModel.owner_id == owner_id)
    deleted = q.delete()
    return deleted > 0

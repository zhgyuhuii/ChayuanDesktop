"""vg_sources_config 表 CRUD。返 dict,不暴露 ORM。"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, Column, DateTime, String, Text, func
from sqlalchemy.orm import Session

from chayuan.server.db.base import Base
from chayuan.server.db.session import with_session

logger = logging.getLogger("chayuan.video_generation.sources.config_store")


class VgSourcesConfigModel(Base):
    __tablename__ = "vg_sources_config"

    source_name = Column(String(32), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
    api_key = Column(Text, nullable=True)
    config_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


def _row_to_dict(r: VgSourcesConfigModel, reveal: bool = False) -> Dict[str, Any]:
    api_key = r.api_key or ""
    return {
        "source_name": r.source_name,
        "enabled": bool(r.enabled),
        "api_key": api_key if reveal else ("已配" if api_key else ""),
        "has_api_key": bool(api_key),
        "config": json.loads(r.config_json) if r.config_json else {},
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@with_session
def list_configs(session: Session, *, reveal: bool = False) -> List[Dict[str, Any]]:
    rows = session.query(VgSourcesConfigModel).order_by(VgSourcesConfigModel.source_name).all()
    return [_row_to_dict(r, reveal=reveal) for r in rows]


@with_session
def get_config(session: Session, source_name: str, *, reveal: bool = False) -> Optional[Dict[str, Any]]:
    r = session.query(VgSourcesConfigModel).filter(
        VgSourcesConfigModel.source_name == source_name,
    ).one_or_none()
    return _row_to_dict(r, reveal=reveal) if r else None


@with_session
def upsert_config(
    session: Session, source_name: str, *,
    enabled: Optional[bool] = None,
    api_key: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    r = session.query(VgSourcesConfigModel).filter(
        VgSourcesConfigModel.source_name == source_name,
    ).one_or_none()
    if r is None:
        r = VgSourcesConfigModel(source_name=source_name)
        session.add(r)
    if enabled is not None:
        r.enabled = bool(enabled)
    if api_key is not None:
        r.api_key = api_key or None
    if config is not None:
        r.config_json = json.dumps(config, ensure_ascii=False) if config else None
    session.flush()
    return _row_to_dict(r, reveal=True)

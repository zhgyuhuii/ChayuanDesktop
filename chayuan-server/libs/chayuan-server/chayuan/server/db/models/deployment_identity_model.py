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

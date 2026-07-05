from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from chacmd.interfaces.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(128), index=True)          # #20 Task-as-API contract id
    goal: Mapped[str] = mapped_column(String)
    dept: Mapped[str] = mapped_column(String(64), index=True)          # tenant = dept (RLS key, NFR-T1)
    state: Mapped[str] = mapped_column(String(32), default="queued")
    token_budget: Mapped[int] = mapped_column(Integer, default=0)  # per-job 硬预算，0=不限(NFR-C1)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(String(32), index=True)
    nickname: Mapped[str] = mapped_column(String(128))                 # logical, no IP
    state: Mapped[str] = mapped_column(String(32), default="queued")


class ContainerReg(Base):
    __tablename__ = "container_reg"

    nickname: Mapped[str] = mapped_column(String(128), primary_key=True)  # logical id
    session: Mapped[str] = mapped_column(String(128))                     # reverse-WS session handle (NOT ip)
    dept: Mapped[str] = mapped_column(String(64), index=True)
    last_heartbeat: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(String(32))
    container: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(32))
    seq: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

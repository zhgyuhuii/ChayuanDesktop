from __future__ import annotations

from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base for all ChaCMD models."""


class Database:
    """I2 — dialect-agnostic DB access. SQLite in tests, Postgres (or 达梦/金仓) in prod.

    Callers MUST go through session()/create_all() and never emit dialect-specific SQL.
    """

    def __init__(self, url: str) -> None:
        self._engine = create_async_engine(url, future=True)
        self._sessionmaker = async_sessionmaker(self._engine, expire_on_commit=False)

    @property
    def dialect(self) -> str:
        return self._engine.dialect.name

    async def create_all(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    @asynccontextmanager
    async def session(self) -> AsyncSession:
        async with self._sessionmaker() as s:
            yield s

    async def dispose(self) -> None:
        await self._engine.dispose()

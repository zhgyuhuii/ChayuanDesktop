"""技能翻译缓存 ORM —— 外部 agent 技能名/描述/README 经本地 LLM 译为中文后落库。

每行 = 一条 (system, skill_id, version, field, lang, text-hash) 唯一翻译结果,
``cache_key`` 由 ``agent_connector.translation._key`` 计算。命中缓存即跳过 LLM 调用。

安全约束:权限清单 (permissions) **永不**机翻,不会写入本表,避免误导用户对
恶意技能放行。该约束在 ``translation.translate_field`` 入口强制。
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint, func

from chayuan.server.db.base import Base


class SkillTranslationModel(Base):
    __tablename__ = "skill_translation"
    __table_args__ = (UniqueConstraint("cache_key", name="uq_skill_tr_key"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_key = Column(String(256), nullable=False)
    translated_text = Column(Text, nullable=False)
    create_time = Column(DateTime, default=func.now())

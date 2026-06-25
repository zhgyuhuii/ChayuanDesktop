"""按用户的工具关闭记录(opt-out)。

一行 = 该用户**关闭**了该工具;不在表 = 启用。有效工具 = 全局启用 − 本表(见 tools.user_tools)。
新表:create_all 会自动建(不踩"create_all 不 ALTER 已存在表"的坑);单机/网络都生效。
"""
from sqlalchemy import Column, DateTime, Integer, String, func

from chayuan.server.db.base import Base


class UserToolPrefModel(Base):
    __tablename__ = "user_tool_pref"

    user_id = Column(Integer, primary_key=True, nullable=False, comment="users.id;关闭该工具的用户")
    tool_name = Column(String(128), primary_key=True, nullable=False, comment="被关闭的运行时工具名")
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<UserToolPref(user_id={self.user_id}, tool={self.tool_name})>"

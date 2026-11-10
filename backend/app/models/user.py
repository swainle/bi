"""用户模型."""

from datetime import datetime, timezone
from typing import Optional

import json

from sqlalchemy import String, DateTime, func, Text, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.rbac import user_role


class User(Base):
    """用户表."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user", server_default="user", nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="1", nullable=False)
    # 权限位：JSON 字符串，如 '{"admin_panel":true,"user_management":true,...}'
    # 管理员默认所有权限为 true
    permissions: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # RBAC 扩展字段
    department_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("departments.id"), nullable=True, index=True
    )
    # 头像 URL（相对于 uploads 目录或绝对 URL）
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # 令牌版本号：每次登录 +1，旧令牌自动失效（单设备登录）
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 计费字段
    plan: Mapped[Optional[str]] = mapped_column(String(30), nullable=True, default="free")
    plan_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # OAuth2 第三方登录
    oauth_provider: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    oauth_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    # 头像（第三方 OAuth 头像 URL）
    avatar: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 关系
    department = relationship("Department", backref="users", lazy="joined")
    roles = relationship("Role", secondary=user_role, backref="users", lazy="selectin")

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username!r})>"

"""RBAC 权限模型 — 部门 / 角色 / 权限"""
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.database import Base

# 用户-角色关联表
user_role = Table(
    "user_role", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

# 角色-权限关联表
role_permission = Table(
    "role_permission", Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_code", String(50), ForeignKey("permissions.code", ondelete="CASCADE"), primary_key=True),
)


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    parent_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    sort_order = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    parent = relationship("Department", remote_side=[id], backref="children")


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False, unique=True)
    code = Column(String(50), nullable=False, unique=True)
    description = Column(String(200), default="")
    is_system = Column(Boolean, default=False)  # 系统内置角色不可删除
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # 该角色拥有的权限码列表（从 role_permission 表加载）
    permissions = relationship("Permission", secondary=role_permission, back_populates="roles", lazy="selectin")


class Permission(Base):
    """硬编码权限定义表（由种子数据初始化）"""
    __tablename__ = "permissions"

    code = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    group = Column(String(50), default="")  # 权限分组：kb / teamspace / user / system

    roles = relationship("Role", secondary=role_permission, back_populates="permissions")

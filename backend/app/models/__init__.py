"""数据模型 —— 明策BI 仅保留认证与 RBAC 模型."""

from app.models.rbac import Department, Permission, Role, role_permission, user_role
from app.models.user import User

__all__ = ["User", "Role", "Permission", "Department", "user_role", "role_permission"]

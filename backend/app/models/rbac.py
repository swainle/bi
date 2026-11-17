"""兼容垫片：RBAC 模型已迁到 `app.rbac.models`（B32）."""

from app.rbac.models import Department, Permission, Role, role_permission, user_role

__all__ = ["Department", "Permission", "Role", "role_permission", "user_role"]

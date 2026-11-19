"""兼容垫片：RBAC 种子已迁到 `app.rbac.seed`（B32）."""

from app.rbac.seed import DEFAULT_ROLES, PERMISSIONS, seed_permissions, seed_roles

__all__ = ["DEFAULT_ROLES", "PERMISSIONS", "seed_permissions", "seed_roles"]

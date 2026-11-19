"""兼容垫片：权限与数据范围已迁到 `app.rbac.permissions`（B32）."""

from app.rbac.permissions import *  # noqa: F401,F403
from app.rbac.permissions import __all__ as __all__  # noqa: F401

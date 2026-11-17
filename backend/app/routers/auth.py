"""兼容垫片：认证路由已迁到 `app.auth.router`（B03）.

保留 `get_current_user` 的转发，因为历史代码里有 `from app.routers.auth import get_current_user`。
"""

from app.auth.deps import get_current_user, get_optional_user
from app.auth.router import router

__all__ = ["router", "get_current_user", "get_optional_user"]

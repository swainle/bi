"""兼容垫片：认证依赖已迁到 `app.auth.deps`（B03）."""

from app.auth.deps import get_current_user, get_optional_user, security

__all__ = ["get_current_user", "get_optional_user", "security"]

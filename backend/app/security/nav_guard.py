"""兼容垫片：入口守卫已迁到 `app.security.nav`（B37）."""

from app.security.nav import has_nav, require_nav, require_nav_any

__all__ = ["has_nav", "require_nav", "require_nav_any"]

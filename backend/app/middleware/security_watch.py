"""兼容垫片：安全指纹中间件已迁到 `app.security.guard.watch`（B34）."""

from app.security.guard.watch import SecurityWatchMiddleware

__all__ = ["SecurityWatchMiddleware"]

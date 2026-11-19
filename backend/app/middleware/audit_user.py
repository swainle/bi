"""兼容垫片：审计用户中间件已迁到 `app.audit.user_middleware`（B33）."""

from app.audit.user_middleware import AuditUserMiddleware

__all__ = ["AuditUserMiddleware"]

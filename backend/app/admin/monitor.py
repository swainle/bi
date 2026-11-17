"""兼容垫片：操作监控路由已迁到 `app.audit.monitor`（B33）."""

from app.audit.monitor import router

__all__ = ["router"]

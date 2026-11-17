"""兼容垫片：查询契约 API 已迁到 `app.query.api`（B14）."""

from app.query.api import router

__all__ = ["router"]

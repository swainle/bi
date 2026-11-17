"""兼容垫片：错误日志已迁到 `app.observability.errors`（B05）."""

from app.observability.errors import repository, router

__all__ = ["repository", "router"]

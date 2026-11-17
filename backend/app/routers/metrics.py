"""兼容垫片：进程指标路由已迁到 `app.observability.router`（B05）."""

from app.observability.router import collect, metrics_endpoint, router

__all__ = ["collect", "metrics_endpoint", "router"]

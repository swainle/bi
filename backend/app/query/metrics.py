"""兼容垫片：进程指标已迁到 `app.observability.metrics`（B05）."""

from app.observability.metrics import decr, get, incr, reset, set_value, snapshot

__all__ = ["decr", "get", "incr", "reset", "set_value", "snapshot"]

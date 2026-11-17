"""兼容垫片：慢查询已迁到 `app.observability.slowlog`（B05）."""

from app.observability.slowlog import recent, record, retention_days, threshold_ms

__all__ = ["recent", "record", "retention_days", "threshold_ms"]

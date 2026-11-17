"""兼容垫片：安全事件已迁到 `app.audit.events`（B33）."""

from app.audit.events import (
    SUSPICIOUS_MARKERS,
    fingerprint,
    is_suspicious_path,
    record,
    sample_external_db_sessions,
)

__all__ = [
    "SUSPICIOUS_MARKERS",
    "fingerprint",
    "is_suspicious_path",
    "record",
    "sample_external_db_sessions",
]

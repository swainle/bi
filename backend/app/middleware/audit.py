"""兼容垫片：操作流水已迁到 `app.audit.log`（B33）."""

from app.audit.log import log_audit

__all__ = ["log_audit"]

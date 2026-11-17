"""兼容垫片：审计上下文已迁到 `app.audit.context`（B33）."""

from app.audit.context import (
    get_audit_user,
    get_request_meta,
    set_audit_user,
    set_request_meta,
)

__all__ = ["get_audit_user", "get_request_meta", "set_audit_user", "set_request_meta"]

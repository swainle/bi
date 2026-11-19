"""兼容垫片：已迁到 `app.security.dataset`（B10）."""

from app.security.dataset.scope import (  # noqa: F401
    DeptScopeError,
    get_rule,
    set_rule,
    delete_rule,
    condition_for,
)

__all__ = [
    "DeptScopeError",
    "get_rule",
    "set_rule",
    "delete_rule",
    "condition_for",
]

"""兼容垫片：已迁到 `app.security.dataset`（B10）."""

from app.security.dataset.access import (  # noqa: F401
    department_of,
    can_access_dataset,
    assert_dataset_visible,
    validate_dept_choice,
)

__all__ = [
    "department_of",
    "can_access_dataset",
    "assert_dataset_visible",
    "validate_dept_choice",
]

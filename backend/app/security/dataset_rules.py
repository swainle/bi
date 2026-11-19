"""兼容垫片：已迁到 `app.security.dataset`（B10）."""

from app.security.dataset.rules import (  # noqa: F401
    DatasetRuleError,
    list_rules,
    add_row_rule,
    delete_row_rule,
    set_mask,
    delete_mask,
    row_conditions,
    apply_dataset_masks,
)

__all__ = [
    "DatasetRuleError",
    "list_rules",
    "add_row_rule",
    "delete_row_rule",
    "set_mask",
    "delete_mask",
    "row_conditions",
    "apply_dataset_masks",
]

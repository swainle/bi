"""兼容垫片：已迁到 `app.security.dataset`（B10）."""

from app.security.dataset.masking import (  # noqa: F401
    mask_rules,
    apply_masks,
    MASK_FUNCS,
)

__all__ = [
    "mask_rules",
    "apply_masks",
    "MASK_FUNCS",
]

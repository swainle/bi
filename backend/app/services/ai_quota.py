"""兼容垫片：已迁到 `app.ai.engine`（B38）."""

from app.ai.engine.quota import (  # noqa: F401
    add_tokens,
    reserve,
)

__all__ = [
    "add_tokens",
    "reserve",
]

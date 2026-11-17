"""兼容垫片：已迁到 `app.ai.engine`（B38）."""

from app.ai.engine.phase3 import (  # noqa: F401
    ai_generate_alert_rules,
    ai_large_screen_layout,
    ai_root_cause_analysis,
    batch_generate_dashboards,
)

__all__ = [
    "ai_generate_alert_rules",
    "ai_large_screen_layout",
    "ai_root_cause_analysis",
    "batch_generate_dashboards",
]

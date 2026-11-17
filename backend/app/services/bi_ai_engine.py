"""兼容垫片：已迁到 `app.ai.engine`（B38）."""

from app.ai.engine.core import (  # noqa: F401
    _call_llm,
    _fallback_config,
    collect_metadata,
    run_ai_pipeline,
    search_knowledge,
    validate_sql,
)

__all__ = [
    "_call_llm",
    "_fallback_config",
    "collect_metadata",
    "run_ai_pipeline",
    "search_knowledge",
    "validate_sql",
]

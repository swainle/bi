"""兼容垫片：已迁到 `app.ai.engine`（B38）."""

from app.ai.engine.agent import (  # noqa: F401
    run_agent_pipeline,
)

__all__ = [
    "run_agent_pipeline",
]

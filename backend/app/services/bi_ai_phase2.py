"""兼容垫片：已迁到 `app.ai.engine`（B38）."""

from app.ai.engine.phase2 import (  # noqa: F401
    analyze_data_quality,
    auto_build_model,
    chat_iterate,
    compute_layout,
    create_task,
    get_task,
    kb_delete_metric,
    kb_list_metrics,
    kb_list_templates,
    kb_upsert_metric,
    kb_upsert_template,
    update_task,
)

__all__ = [
    "analyze_data_quality",
    "auto_build_model",
    "chat_iterate",
    "compute_layout",
    "create_task",
    "get_task",
    "kb_delete_metric",
    "kb_list_metrics",
    "kb_list_templates",
    "kb_upsert_metric",
    "kb_upsert_template",
    "update_task",
]

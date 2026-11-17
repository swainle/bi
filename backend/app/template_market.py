"""兼容垫片：模板市场已迁到 `app.templates.market`（B19）."""

from app.templates.market import (
    CATEGORIES,
    TemplateError,
    _copy_dataset,
    clone_template,
    dataset_template_map,
    doc_dataset_ids,
    get_template,
    list_template_datasets,
    list_templates,
    share_board,
)

__all__ = [
    "CATEGORIES", "TemplateError", "_copy_dataset", "clone_template", "dataset_template_map",
    "doc_dataset_ids", "get_template", "list_template_datasets", "list_templates", "share_board",
]

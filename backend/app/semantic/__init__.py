"""语义层 —— 数据集 / 字段 / 指标，让看板不直连物理表.

对外 API：
    repository.list_datasets / get_dataset / create_dataset / delete_dataset
    repository.add_field / list_fields / delete_field
    repository.add_metric / list_metrics / delete_metric
    compiler.compile_query(dataset, request) -> QueryObject
    validator.* 建模期校验

路由：
    app.semantic.router       数据集 CRUD + 按语义查询
    app.semantic.router_items 字段 / 指标子资源
"""

from app.semantic.compiler import compile_query
from app.semantic.models import Dataset, DatasetField, DatasetMetric
from app.semantic.validator import SemanticError

__all__ = [
    "Dataset",
    "DatasetField",
    "DatasetMetric",
    "compile_query",
    "SemanticError",
]

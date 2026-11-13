"""语义层编译器 —— 把「用户按语义名提的请求」翻译成 QueryObject.

这是语义层的核心价值：
    前端只说「按店铺看销售额」，不关心物理列叫 store、聚合是 SUM(revenue)。
"""

from __future__ import annotations

from app.query.contract import (
    DimensionSpec,
    FilterSpec,
    KeywordSpec,
    MetricSpec,
    OrderSpec,
    QueryObject,
)
from app.semantic.models import Dataset
from app.semantic.validator import SemanticError


def _field(dataset: Dataset, name: str):
    field = dataset.field_by_name(name)
    if field is None:
        raise SemanticError(f"未知字段：{name}（数据集 {dataset.name}）")
    return field


def _metric(dataset: Dataset, name: str):
    metric = dataset.metric_by_name(name)
    if metric is None:
        raise SemanticError(f"未知指标：{name}（数据集 {dataset.name}）")
    return metric


def compile_query(dataset: Dataset, request: dict) -> QueryObject:
    """request 形如：
        {
          "dimensions": [{"name": "store", "grain": null}],
          "metrics": ["gmv", "orders"],
          "filters": [{"name": "store", "op": "=", "value": "A店"}],
          "order_by": [{"name": "gmv", "desc": true}],
          "limit": 500, "offset": 0
        }
    """
    if not dataset.is_active:
        raise SemanticError(f"数据集已停用：{dataset.name}")

    dimensions: list[DimensionSpec] = []
    for item in request.get("dimensions", []) or []:
        if isinstance(item, str):
            item = {"name": item}
        field = _field(dataset, item.get("name", ""))
        if not field.is_groupable:
            raise SemanticError(f"字段不可分组：{field.name}")
        grain = item.get("grain", field.default_grain if field.role == "time" else None)
        dimensions.append(
            DimensionSpec(column=field.source_column, grain=grain, alias=field.name)
        )

    columns: list[DimensionSpec] = []
    for item in request.get("columns", []) or []:
        if isinstance(item, str):
            item = {"name": item}
        field = _field(dataset, item.get("name", ""))
        columns.append(DimensionSpec(column=field.source_column, grain=None, alias=field.name))

    metrics: list[MetricSpec] = []
    for item in request.get("metrics", []) or []:
        if isinstance(item, str):
            item = {"name": item}
        name = item.get("name", "")
        metric = dataset.metric_by_name(name)
        if metric is not None:
            metrics.append(MetricSpec(expression=metric.expression, alias=metric.name))
            continue
        # 未登记指标：允许按「字段 + 聚合」临时组合（仍是白名单内的列）
        field = _field(dataset, name)
        agg_name = str(item.get("agg", "SUM")).upper()
        # 标识字段只有「计数」有意义（词云按词出现次数、明细行数）；SUM/AVG 这类一律拒绝
        if field.role == "id" and agg_name not in ("COUNT", "COUNT_DISTINCT"):
            raise SemanticError(f"标识字段不能聚合：{field.name}（只能计数）")
        metrics.append(
            MetricSpec(
                column=field.source_column,
                agg=item.get("agg", "SUM"),
                # 允许调用方给别名（词云按维度计数时，避免与维度列同名）
                alias=str(item.get("alias") or field.name),
            )
        )

    filters: list[FilterSpec] = []
    for item in request.get("filters", []) or []:
        field = _field(dataset, item.get("name", item.get("column", "")))
        if not field.is_filterable:
            raise SemanticError(f"字段不可筛选：{field.name}")
        filters.append(
            FilterSpec(
                column=field.source_column,
                op=item.get("op", "="),
                value=item.get("value"),
                grain=item.get("grain"),
            )
        )

    order_by: list[OrderSpec] = []
    for item in request.get("order_by", []) or []:
        if isinstance(item, str):
            item = {"name": item}
        name = item.get("name", "")
        target = dataset.field_by_name(name) or dataset.metric_by_name(name)
        if target is None:
            raise SemanticError(f"排序字段未知：{name}")
        order_by.append(OrderSpec(column=name, desc=bool(item.get("desc", True))))

    # 跨列模糊搜索（筛选栏「搜索」控件 → 明细表挂载的列）
    keyword_spec = request.get("keyword") or {}
    keyword = None
    kw_value = str(keyword_spec.get("value") or "").strip()
    kw_columns: list[str] = []
    for name in keyword_spec.get("columns") or []:
        if not name:
            continue
        try:
            field = _field(dataset, str(name))
        except Exception:
            continue
        if field.data_type in ("text",) and field.source_column not in kw_columns:
            kw_columns.append(field.source_column)
    if kw_value and kw_columns:
        keyword = KeywordSpec(columns=kw_columns, value=kw_value)

    return QueryObject(
        table=dataset.physical_table or "custom_sql",
        subquery=(dataset.sql_text or None),
        dimensions=dimensions,
        columns=columns,
        metrics=metrics,
        filters=filters,
        keyword=keyword,
        order_by=order_by,
        limit=request.get("limit", 500),
        offset=request.get("offset", 0),
    )


__all__ = ["compile_query"]

"""语义层回归：校验器 + 编译器（不连数据库）.

用真实 Dataset 对象构造，验证「语义名 → 物理列 / 聚合表达式」的翻译，
以及各类非法请求是否被拦截。
"""

from __future__ import annotations

import pytest

from app.query.contract import QueryObject
from app.semantic.compiler import compile_query
from app.semantic.models import Dataset, DatasetField, DatasetMetric
from app.semantic.validator import (
    SemanticError,
    validate_format,
    validate_metric_expression,
    validate_role,
)


def _dataset() -> Dataset:
    return Dataset(
        id=1,
        name="店铺利润",
        physical_table="bi_pdd_profit",
        fields=[
            DatasetField(1, 1, "店铺", "store", role="dimension"),
            DatasetField(2, 1, "负责人", "person", role="dimension"),
            DatasetField(3, 1, "日期", "date", role="time", default_grain="month"),
            DatasetField(4, 1, "收入", "revenue", role="measure"),
        ],
        metrics=[
            DatasetMetric(1, 1, "总收入", "SUM(revenue)", format="currency"),
        ],
    )


# ── 校验器 ──────────────────────────────────────────────────
def test_metric_expression_ok() -> None:
    assert validate_metric_expression("SUM(revenue)") == "SUM(revenue)"
    assert validate_metric_expression("SUM(gross) / COUNT(DISTINCT id)")


@pytest.mark.parametrize(
    "expr",
    [
        "revenue",                       # 没有聚合
        "SUM((SELECT 1))",               # 子查询
        "SUM(revenue); DROP TABLE x",     # 多语句
        "pg_read_file('/etc/passwd')",    # 危险函数
        "",
    ],
)
def test_metric_expression_rejected(expr: str) -> None:
    with pytest.raises(SemanticError):
        validate_metric_expression(expr)


def test_role_and_format() -> None:
    assert validate_role("TIME") == "time"
    assert validate_format("Percent") == "percent"
    with pytest.raises(SemanticError):
        validate_role("measurement")
    with pytest.raises(SemanticError):
        validate_format("rmb")


# ── 编译器 ──────────────────────────────────────────────────
def test_compile_dimension_and_metric() -> None:
    qo = compile_query(_dataset(), {
        "dimensions": ["店铺"],
        "metrics": ["总收入"],
    })
    assert isinstance(qo, QueryObject)
    assert qo.table == "bi_pdd_profit"
    assert qo.dimensions[0].column == "store"
    assert qo.dimensions[0].alias == "店铺"
    assert qo.metrics[0].expression == "SUM(revenue)"
    assert qo.metrics[0].alias == "总收入"


def test_time_field_uses_default_grain() -> None:
    qo = compile_query(_dataset(), {"dimensions": ["日期"], "metrics": ["总收入"]})
    assert qo.dimensions[0].grain == "month"


def test_grain_override() -> None:
    qo = compile_query(
        _dataset(),
        {"dimensions": [{"name": "日期", "grain": "year"}], "metrics": ["总收入"]},
    )
    assert qo.dimensions[0].grain == "year"


def test_metric_by_field_fallback() -> None:
    qo = compile_query(_dataset(), {"dimensions": ["店铺"], "metrics": ["收入"]})
    assert qo.metrics[0].column == "revenue"
    assert qo.metrics[0].agg == "SUM"


def test_filter_maps_to_source_column() -> None:
    qo = compile_query(
        _dataset(),
        {"dimensions": ["店铺"], "metrics": ["总收入"],
         "filters": [{"name": "店铺", "op": "=", "value": "A店"}]},
    )
    assert qo.filters[0].column == "store"
    assert qo.filters[0].value == "A店"


def test_unknown_field_rejected() -> None:
    with pytest.raises(SemanticError):
        compile_query(_dataset(), {"dimensions": ["不存在的字段"]})


def test_inactive_dataset_rejected() -> None:
    dataset = _dataset()
    dataset.is_active = False
    with pytest.raises(SemanticError):
        compile_query(dataset, {"dimensions": ["店铺"]})


def test_order_by_accepts_semantic_name() -> None:
    qo = compile_query(
        _dataset(),
        {"dimensions": ["店铺"], "metrics": ["总收入"],
         "order_by": [{"name": "总收入", "desc": True}]},
    )
    assert qo.order_by[0].column == "总收入"


# ── 数据集改名：名称规整（改名只校验名字，不碰物理表 / 取数方式 / 数据源）──
def test_dataset_name_normalized() -> None:
    from app.semantic.repository import normalize_dataset_name

    assert normalize_dataset_name("  榜单端-抖音  ") == "榜单端-抖音"
    assert normalize_dataset_name("a" * 120) == "a" * 120
    for bad in ("", "   ", None, "长" * 121):
        with pytest.raises(SemanticError):
            normalize_dataset_name(bad)

"""dbt / LookML 语义模型导入：解析与计划（纯函数，不连库）."""

from __future__ import annotations

import json

import pytest

from app.semantic.importer import plan
from app.semantic.models import DatasetField, DatasetMetric
from app.semantic.validator import SemanticError

FIELDS = [
    DatasetField(id=1, dataset_id=1, name="成交金额", source_column="gmv"),
    DatasetField(id=2, dataset_id=1, name="订单数", source_column="orders"),
    DatasetField(id=3, dataset_id=1, name="店铺", source_column="store"),
    DatasetField(id=4, dataset_id=1, name="买家数", source_column="buyer_id"),
    DatasetField(id=5, dataset_id=1, name="支付状态", source_column="pay_status"),
]


def _dbt_manifest() -> str:
    return json.dumps({
        "metadata": {"dbt_version": "1.8.0"},
        "semantic_models": {
            "semantic_model.jaffle.fct_orders": {
                "measures": [
                    {"name": "gmv", "agg": "sum", "expr": "gmv"},
                    {"name": "orders", "agg": "sum", "expr": "orders"},
                    {"name": "buyers", "agg": "count_distinct", "expr": "buyer_id"},
                ],
            },
        },
        "metrics": {
            "metric.jaffle.gmv": {
                "name": "gmv", "type": "simple",
                "type_params": {"measure": {"name": "gmv"}},
                "description": "成交金额", "meta": {"format": "currency"},
            },
            "metric.jaffle.order_count": {
                "name": "order_count", "type": "simple",
                "type_params": {"measure": {"name": "orders"}},
            },
            "metric.jaffle.aov": {
                "name": "aov", "type": "ratio",
                "type_params": {"numerator": "gmv", "denominator": "order_count"},
                "description": "客单价",
            },
            "metric.jaffle.buyers": {
                "name": "buyer_count", "type": "simple",
                "type_params": {"measure": {"name": "buyers"}},
            },
            "metric.jaffle.old_count": {
                "name": "order_rows", "calculation_method": "count", "expression": "*",
            },
            "metric.jaffle.derived": {
                "name": "derived_one", "type": "derived",
                "type_params": {"expr": "gmv / orders"},
            },
        },
        "nodes": {
            "model.jaffle.fct_orders": {
                "resource_type": "model",
                "columns": {
                    "store": {"name": "store", "description": "店铺名称"},
                    "gmv": {"name": "gmv", "description": "成交金额"},
                },
            },
        },
    })


def test_dbt_simple_ratio_and_legacy() -> None:
    result = plan("dbt", _dbt_manifest(), [], FIELDS)
    metrics = {m["name"]: m for m in result["metrics"]}

    assert metrics["gmv"]["expression"] == "SUM(gmv)"
    assert metrics["gmv"]["format"] == "currency"
    assert metrics["gmv"]["action"] == "new"
    # ratio：分子 / 分母都是 simple 指标，换成等价聚合 + NULLIF 防除零
    assert metrics["aov"]["expression"] == "SUM(gmv) / NULLIF(SUM(orders), 0)"
    assert metrics["buyer_count"]["expression"] == "COUNT(DISTINCT buyer_id)"
    # dbt <= 1.5 的 calculation_method + expression
    assert metrics["order_rows"]["expression"] == "COUNT(*)"

    skipped = {s["name"]: s["reason"] for s in result["skipped"]}
    assert "derived_one" in skipped and "derived" in skipped["derived_one"]
    # 列说明按源列匹配到数据集字段
    fields = {f["name"]: f for f in result["fields"]}
    assert fields["店铺"]["description"] == "店铺名称"
    assert fields["店铺"]["action"] == "update"
    assert result["summary"]["new"] == 5


def test_dbt_unknown_column_skipped() -> None:
    manifest = json.dumps({
        "semantic_models": {"sm": {"measures": [{"name": "x", "agg": "sum", "expr": "nope"}]}},
        "metrics": {"m": {"name": "x_metric", "type": "simple",
                          "type_params": {"measure": {"name": "x"}}}},
    })
    result = plan("dbt", manifest, [], FIELDS)
    assert result["metrics"] == []
    assert "列不在数据集里" in result["skipped"][0]["reason"]


def test_metric_update_and_unchanged_actions() -> None:
    existing = [
        DatasetMetric(id=10, dataset_id=1, name="gmv", expression="SUM(gmv)", format="currency"),
        DatasetMetric(id=11, dataset_id=1, name="order_rows", expression="COUNT(*)", format="number"),
    ]
    result = plan("dbt", _dbt_manifest(), existing, FIELDS)
    actions = {m["name"]: m["action"] for m in result["metrics"]}
    assert actions["gmv"] == "unchanged"
    assert actions["order_rows"] == "unchanged"
    assert actions["aov"] == "new"
    assert next(m for m in result["metrics"] if m["name"] == "gmv")["metric_id"] == 10

    # 改口径 → update，并提示会升版本 / 掉认证
    changed = plan(
        "dbt",
        _dbt_manifest().replace('"expr": "gmv"', '"expr": "gmv_amount"'),
        [DatasetMetric(id=10, dataset_id=1, name="gmv", expression="SUM(gmv)", format="currency")],
        FIELDS + [DatasetField(id=4, dataset_id=1, name="gmv_amount", source_column="gmv_amount")],
    )
    gmv = next(m for m in changed["metrics"] if m["name"] == "gmv")
    assert gmv["action"] == "update" and "版本" in gmv["note"]


LOOKML = """
# 订单视图
view: order_fact {
  sql_table_name: analytics.order_fact ;;

  dimension: order_id {
    type: string
    sql: ${TABLE}.order_id ;;
  }

  dimension: store {
    type: string
    description: "店铺名称"
    sql: ${TABLE}.store ;;
  }

  dimension: gmv {
    type: number
    sql: ${TABLE}.gmv ;;
  }

  measure: orders {
    type: count
    sql: 1 ;;
  }

  measure: gmv_total {
    type: sum
    value_format_name: usd
    sql: ${gmv} ;;
  }

  measure: buyer_count {
    type: count_distinct
    sql: ${TABLE}.buyer_id ;;
  }

  measure: paid_gmv {
    type: sum
    sql: ${gmv} ;;
    filters: [pay_status: "paid"]
  }

  measure: median_gmv {
    type: median
    sql: ${gmv} ;;
  }
}
"""


def test_lookml_measures_and_dimensions() -> None:
    result = plan("lookml", LOOKML, [], FIELDS)
    metrics = {m["name"]: m for m in result["metrics"]}

    assert metrics["orders"]["expression"] == "COUNT(*)"
    assert metrics["gmv_total"]["expression"] == "SUM(gmv)"
    assert metrics["gmv_total"]["format"] == "currency"
    assert metrics["buyer_count"]["expression"] == "COUNT(DISTINCT buyer_id)"
    # filters → CASE WHEN，口径仍是一个聚合表达式
    assert metrics["paid_gmv"]["expression"] == "SUM(CASE WHEN \"pay_status\" = 'paid' THEN gmv END)"

    skipped = {s["name"]: s["reason"] for s in result["skipped"]}
    assert "order_fact.median_gmv" in skipped

    fields = {f["name"]: f for f in result["fields"]}
    assert fields["店铺"]["description"] == "店铺名称"


def test_lookml_or_filters_skipped() -> None:
    lookml = """
view: v {
  dimension: gmv { type: number sql: ${TABLE}.gmv ;; }
  measure: paid { type: sum sql: ${gmv} ;; filters: [pay_status: "paid,shipped"] }
}
"""
    result = plan("lookml", lookml, [], FIELDS)
    assert result["metrics"] == []
    assert "OR" in result["skipped"][0]["reason"]


def test_lookml_filter_on_count_measure() -> None:
    """`sql: 1` + filters 也要翻成 CASE（否则筛选被静默丢掉）."""
    lookml = """
view: v {
  measure: paid_orders { type: count sql: 1 ;; filters: [pay_status: "paid"] }
}
"""
    result = plan("lookml", lookml, [], FIELDS)
    assert result["metrics"][0]["expression"] == "COUNT(CASE WHEN \"pay_status\" = 'paid' THEN 1 END)"


def test_invalid_inputs() -> None:
    with pytest.raises(SemanticError):
        plan("dbt", "{not json", [], FIELDS)
    with pytest.raises(SemanticError):
        plan("lookml", "select 1", [], FIELDS)
    with pytest.raises(SemanticError):
        plan("superset", "{}", [], FIELDS)
    with pytest.raises(SemanticError):
        plan("dbt", "   ", [], FIELDS)

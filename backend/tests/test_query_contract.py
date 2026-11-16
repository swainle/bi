"""查询契约 + SQL 编译回归.

重点验证：
    * 标识符校验（防注入）
    * 值一律绑定参数（SQL 里不出现字面量）
    * 粒度出现在 SELECT 与 GROUP BY
    * 行级条件进入 WHERE（且位置在 GROUP BY 之前）
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.query.builder import build
from app.query.contract import QueryObject
from app.security.errors import TableNotAllowedError

ALLOWED = {"bi_finance", "bi_pdd_profit"}


def _qo(**kwargs) -> QueryObject:
    base = {"table": "bi_pdd_profit"}
    base.update(kwargs)
    return QueryObject(**base)


def test_simple_aggregate_sql() -> None:
    built = build(
        _qo(
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "total"}],
        ),
        allowed_tables=ALLOWED,
    )
    assert 'SELECT "store", SUM("revenue") AS "total"' in built.sql
    assert 'GROUP BY "store"' in built.sql
    assert "LIMIT :_limit" in built.sql
    assert built.params["_limit"] == 500


def test_time_grain_in_select_and_group_by() -> None:
    built = build(
        _qo(
            dimensions=[{"column": "date", "grain": "month"}],
            metrics=[{"column": "gmv", "agg": "SUM", "alias": "g"}],
        ),
        allowed_tables=ALLOWED,
    )
    assert "date_trunc('month', \"date\")" in built.sql
    assert "GROUP BY date_trunc('month', \"date\")" in built.sql


def test_values_are_bound_not_inlined() -> None:
    built = build(
        _qo(
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "t"}],
            filters=[{"column": "store", "op": "=", "value": "A店' OR 1=1 --"}],
        ),
        allowed_tables=ALLOWED,
    )
    assert "A店" not in built.sql
    assert built.params["f0"] == "A店' OR 1=1 --"


def test_in_and_between_binding() -> None:
    built = build(
        _qo(
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "t"}],
            filters=[
                {"column": "person", "op": "IN", "value": ["a", "b"]},
                {"column": "revenue", "op": "BETWEEN", "value": [1, 9]},
            ],
        ),
        allowed_tables=ALLOWED,
    )
    assert built.params["f0_0"] == "a"
    assert built.params["f0_1"] == "b"
    assert built.params["f1_lo"] == 1
    assert built.params["f1_hi"] == 9


def test_rls_conditions_go_before_group_by() -> None:
    built = build(
        _qo(
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "t"}],
        ),
        allowed_tables=ALLOWED,
        rls_conditions=["store = 'A店'"],
    )
    assert built.sql.index("WHERE (store = 'A店')") < built.sql.index("GROUP BY")


def test_bad_identifier_rejected() -> None:
    with pytest.raises(ValidationError):
        _qo(dimensions=[{"column": "store; DROP TABLE x"}])


def test_unknown_aggregate_rejected() -> None:
    with pytest.raises(ValidationError):
        _qo(metrics=[{"column": "revenue", "agg": "EVIL"}])


def test_table_not_in_whitelist() -> None:
    with pytest.raises(TableNotAllowedError):
        build(_qo(table="bi_dashboards"), allowed_tables=ALLOWED)


def test_limit_clamped() -> None:
    assert build(_qo(limit=99999), allowed_tables=ALLOWED).params["_limit"] == 5000


def test_legacy_payload_conversion() -> None:
    qo = QueryObject.from_legacy(
        {
            "table": "bi_pdd_profit",
            "dimensions": ["store"],
            "metrics": [{"col": "revenue", "agg": "SUM", "alias": "t"}],
            "filters": [{"col": "store", "op": "=", "val": "A"}],
        }
    )
    assert qo.dimensions[0].column == "store"
    assert qo.metrics[0].column == "revenue"
    assert qo.filters[0].value == "A"

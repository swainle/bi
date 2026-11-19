import pytest
from sqlalchemy import create_engine, text

from app.components.resolver import _request_for
from app.components.spec import ComponentSpec
from app.dashboards.sources import field_hits_in_doc
from app.query.builder import build
from app.query.contract import QueryObject
from app.semantic.aggregate_expression import compile_aggregate
from app.semantic.compiler import compile_query
from app.semantic.formulas import check_formula_masks
from app.semantic.models import Dataset, DatasetField
from app.security.errors import SecurityError


def dataset():
    return Dataset(1, "订单", "orders", fields=[
        DatasetField(1, 1, "店铺", "store"),
        DatasetField(2, 1, "销售额", "amount", role="measure", data_type="numeric"),
        DatasetField(3, 1, "订单数", "orders_count", role="measure", data_type="numeric"),
        DatasetField(4, 1, "利润", "profit", role="measure", data_type="numeric", expression='"amount" - 10'),
        DatasetField(5, 1, "编号", "id", role="id"),
    ])


def request(expression):
    spec = ComponentSpec.model_validate({"title": "自定义汇总", "binding": {
        "dataset_id": 1, "metric": "销售额", "agg": "CUSTOM", "agg_expression": expression,
    }})
    # 模拟看板保存后重新读取。
    return _request_for(ComponentSpec.model_validate(spec.model_dump()), "kpi")


def test_custom_aggregate_with_group_filter_and_rls():
    req = request('SUM("销售额") * 1.0 / NULLIF(SUM("订单数"), 0)')
    req.update(dimensions=["店铺"], filters=[{"name": "销售额", "op": ">", "value": 50}])
    query = compile_query(dataset(), req)
    built = build(query, rls_conditions=["store = 'A'"])
    with create_engine("sqlite://").begin() as conn:
        conn.execute(text("CREATE TABLE orders(store text, amount numeric, orders_count integer)"))
        conn.execute(text("INSERT INTO orders VALUES ('A',100,2),('A',200,1),('A',10,100),('B',900,1)"))
        assert [dict(r._mapping) for r in conn.execute(text(built.sql), built.params)] == [
            {"店铺": "A", "销售额": 100.0},
        ]


@pytest.mark.parametrize("expression", [
    "", '"销售额" + 1', 'SUM("amount")', 'SUM("不存在")', 'SUM("销售额") + "订单数"',
    'SUM(SUM("销售额"))', 'SUM("销售额") OVER ()', '(SELECT SUM(amount) FROM orders)',
    'SUM("销售额") FROM orders', 'SUM("销售额"), COUNT(*)', 'SUM("销售额") AS other',
    'SUM("销售额"); DELETE FROM orders', 'pg_sleep(SUM("销售额"))',
    'unknown_function(SUM("销售额"))', 'SUM(orders.amount)', 'SUM(:parameter)',
    'SUM(*)', 'SUM("编号")', 'SUM(CAST("销售额" AS custom_type))',
])
def test_reject_invalid_or_unsafe_expression(expression):
    with pytest.raises(SecurityError):
        compile_query(dataset(), request(expression))


@pytest.mark.parametrize("expression", [
    'COUNT(*)', 'COUNT(DISTINCT "店铺")', 'COUNT("编号")',
    'ROUND(AVG("销售额"), 2)', 'SUM(CASE WHEN "订单数" > 0 THEN "销售额" ELSE 0 END)',
])
def test_supported_aggregate_expressions(expression):
    assert compile_aggregate(expression, dataset())


def test_formula_dependency_and_dialect_translation():
    query = compile_query(dataset(), request('SUM("利润")'))
    assert query.calculated_columns == {"profit": '"amount" - 10'}
    query.dialect = "mysql"
    assert 'SUM(`profit`) AS `销售额`' in build(query).sql


def test_median_sql_and_unsupported_dialect():
    query = compile_query(dataset(), request('MEDIAN("销售额")'))
    query = QueryObject.model_validate(query.model_dump())
    assert query.metrics[0].custom_expression
    assert 'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "amount") AS "销售额"' in build(query).sql
    query.dialect = "sqlite"
    # 方言不支持时须明确拒绝，不能发出无法执行的 SQL。
    with pytest.raises(ValueError, match="暂不支持 MEDIAN"):
        build(query)


def test_reject_non_text_expression_at_query_boundary():
    with pytest.raises(SecurityError, match="文本"):
        compile_query(dataset(), {"metrics": [{"name": "销售额", "agg": "CUSTOM", "expression": 123}]})


@pytest.mark.parametrize("scope", ["dataset", "table", "virtual", "virtual_alias"])
def test_custom_aggregate_cannot_bypass_masks(scope):
    ds = dataset()
    if scope == "virtual_alias":
        from dataclasses import replace

        ds.fields[2] = replace(ds.fields[2], source_column="counted")
    query = compile_query(ds, request('SUM("销售额") / NULLIF(SUM("订单数"), 0)'))
    from sqlalchemy.orm import Session

    with Session(create_engine("sqlite://")) as db:
        db.execute(text("CREATE TABLE bi_column_masks(table_name text, column_name text, mask_type text, mask_pattern text)"))
        db.execute(text("CREATE TABLE bi_dataset_column_mask(dataset_id integer, column_name text)"))
        db.execute(text("CREATE TABLE bi_dataset_field(dataset_id integer, name text, source_column text)"))
        db.execute(text("INSERT INTO bi_dataset_field VALUES (1, '订单数', 'orders_count')"))
        if scope == "dataset":
            db.execute(text("INSERT INTO bi_dataset_column_mask VALUES (1, '订单数')"))
        else:
            db.execute(text("INSERT INTO bi_column_masks VALUES ('orders', 'orders_count', 'redact', '')"))
        if scope in ("virtual", "virtual_alias"):
            query.table = "custom_sql"
            alias = ' AS counted' if scope == "virtual_alias" else ''
            query.subquery = f'SELECT amount, orders_count{alias} FROM orders'
        with pytest.raises(SecurityError, match="脱敏"):
            check_formula_masks(db, query, 1)


def test_custom_expression_fields_are_protected_from_rename():
    doc = {"views": [{"key": "main", "items": [{"key": "kpi", "spec": {"binding": {
        "dataset_id": 1, "metric": "销售额", "agg": "CUSTOM",
        "agg_expression": 'SUM("销售额") / NULLIF(SUM("订单数"), 0)',
    }}}]}]}
    hits = field_hits_in_doc(doc, 1, ["订单数", "销售额", "店铺"])
    assert hits["订单数"][0]["role"] == "metric"
    assert len(hits["销售额"]) == 1
    assert hits["店铺"] == []

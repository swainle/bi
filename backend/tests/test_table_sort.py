import sqlite3

import pytest

from app.components.resolver import _request_for
from app.components.spec import ComponentSpec, ComponentSpecError
from app.query.builder import build
from app.semantic.compiler import compile_query
from app.semantic.models import Dataset, DatasetField


def table_spec(**binding):
    return ComponentSpec(title="销量 TOP 10", binding={
        "dimensions": ["商品编号", "日销量"], "sort_field": "日销量", "top_n": 10, **binding,
    })


@pytest.mark.parametrize("sort", ["asc", "desc"])
def test_table_sorts_all_rows_before_limit(sort):
    """明细表按排序字段全量排序后再取上限行（行限制已移除，一律取到 2000 行交给前端分页）."""
    spec = table_spec(sort=sort)
    request = _request_for(spec, "table")
    dataset = Dataset(id=1, name="商品", physical_table="products", fields=[
        DatasetField(1, 1, "商品编号", "item_id", role="id"),
        DatasetField(2, 1, "日销量", "daily_sales", role="measure", data_type="integer"),
    ])
    query = build(compile_query(dataset, request))
    assert query.params["_limit"] == 2000
    assert query.sql.index("ORDER BY") < query.sql.index("LIMIT")
    with sqlite3.connect(":memory:") as connection:
        connection.execute("CREATE TABLE products (item_id INTEGER, daily_sales INTEGER)")
        connection.executemany("INSERT INTO products VALUES (?, ?)", [(i, i) for i in range(3000)])
        connection.execute("INSERT INTO products VALUES (3000, NULL)")
        result = connection.execute(query.sql, query.params).fetchall()
    expected = list(range(2999, 999, -1)) if sort == "desc" else list(range(2000))
    assert [row[1] for row in result] == expected


def test_table_without_sort_field_keeps_existing_query_behavior():
    request = _request_for(table_spec(sort_field=""), "table")
    assert request["order_by"] == []
    assert request["limit"] == 2000


def test_sort_field_must_be_selected():
    with pytest.raises(ComponentSpecError, match="已选择"):
        _request_for(table_spec(sort_field="不存在的字段"), "table")


def test_more_rows_keeps_sort_and_expands_limit():
    spec = table_spec()
    spec.binding.top_n = 2000
    request = _request_for(spec, "table")
    assert request["order_by"] == [{"name": "日销量", "desc": True}]
    assert request["limit"] == 2000

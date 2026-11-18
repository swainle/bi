"""SQL 只读网关的回归用例.

覆盖三类：
    1. 合法查询必须放行（含 CTE / JOIN / 聚合）
    2. 写操作 / 多语句 / 危险函数必须拒绝
    3. 不依赖表名名单，引用表按作用域准确识别
"""

from __future__ import annotations

import pytest

from app.security.errors import (
    NotReadOnlyError,
    SecurityError,
    SqlSyntaxError,
    UnsafeFunctionError,
)
from app.security.sql_guard import (
    guard_readonly,
    referenced_tables,
    to_sql,
)



@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM bi_finance LIMIT 10",
        "select region, sum(revenue) from bi_finance group by region",
        "WITH t AS (SELECT * FROM bi_finance) SELECT count(*) FROM t",
        "SELECT f.id FROM bi_finance f JOIN bi_pdd_stores s ON f.store_id = s.id",
        "SELECT 1;",
    ],
)
def test_valid_sql_passes(sql: str) -> None:
    root = guard_readonly(sql)
    assert root is not None
    assert to_sql(root)


@pytest.mark.parametrize(
    "sql,expected",
    [
        ("DROP TABLE bi_finance", NotReadOnlyError),
        ("DELETE FROM bi_finance", NotReadOnlyError),
        ("UPDATE bi_finance SET a = 1", NotReadOnlyError),
        ("INSERT INTO bi_finance VALUES (1)", NotReadOnlyError),
        ("SELECT * FROM bi_finance; DROP TABLE users", NotReadOnlyError),
        ("SELECT * INTO backup FROM bi_finance", NotReadOnlyError),
        ("SELECT pg_read_file('/etc/passwd')", UnsafeFunctionError),
        ("SELECT pg_sleep(5)", UnsafeFunctionError),
        ("SELECT load_file('/etc/passwd')", UnsafeFunctionError),
        ("", SqlSyntaxError),
        ("   ", SqlSyntaxError),
        ("this is not sql at all (((", SqlSyntaxError),
    ],
)
def test_bad_sql_blocked(sql: str, expected: type[SecurityError]) -> None:
    with pytest.raises(expected):
        guard_readonly(sql)


def test_cte_alias_is_not_treated_as_table() -> None:
    root = guard_readonly(
        "WITH cte AS (SELECT * FROM bi_finance) SELECT * FROM cte",

    )
    assert referenced_tables(root) == {"bi_finance"}


def test_referenced_tables_are_not_filtered_by_name() -> None:
    root = guard_readonly(
        "SELECT * FROM bi_finance JOIN bi_ai_knowledge k ON true",

    )
    # 所有真实源表都参与权限计算，不再按名称筛选。
    assert sorted(referenced_tables(root)) == [
        "bi_ai_knowledge",
        "bi_finance",
    ]


def test_new_business_table_needs_no_registration() -> None:
    root = guard_readonly("SELECT * FROM any_table")
    assert referenced_tables(root) == {"any_table"}

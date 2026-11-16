"""跨方言 SQL 编译一致性.

直连模式（`app/query/live.py`）会把 `QueryObject.dialect` 覆盖成源库方言，
再交给 `builder.build`。这里锁定三件事，避免「PG 能跑、MySQL 语法错」：

    1. 标识符引号按方言：MySQL 反引号 / SQL Server 方括号 / 其余双引号（别名同样收敛）；
    2. MySQL、SQL Server 没有 ILIKE，关键词搜索必须降级成 LIKE；
    3. MySQL、SQL Server 没有 NULLS LAST，排序不能带这段后缀；
    4. 无论哪种方言，值一律走绑定参数（SQL 里不出现字面量）。
"""

from __future__ import annotations

from app.query.builder import build, quote
from app.query.contract import QueryObject

ALLOWED = {"bi_pdd_profit", "dm.v_bangdan"}


def _qo(**kwargs) -> QueryObject:
    base = {"table": "bi_pdd_profit"}
    base.update(kwargs)
    return QueryObject(**base)


def test_quote_by_dialect() -> None:
    assert quote("store", "postgresql") == '"store"'
    assert quote("store", "postgres") == '"store"'
    assert quote("store", "mysql") == "`store`"
    assert quote("store", "clickhouse") == '"store"'
    # schema.table 逐段加引号，不能整体当一个标识符
    assert quote("dm.v_bangdan", "mysql") == "`dm`.`v_bangdan`"
    assert quote("dm.v_bangdan", "postgresql") == '"dm"."v_bangdan"'
    # SQL Server / 别名都收敛到同一套
    assert quote("store", "mssql") == "[store]"
    assert quote("store", "sqlserver") == "[store]"
    assert quote("dm.v_bangdan", "tsql") == "[dm].[v_bangdan]"
    # MariaDB / Doris / StarRocks 走 MySQL 语义
    assert quote("store", "mariadb") == "`store`"
    assert quote("store", "doris") == "`store`"
    # Hive / Impala 用反引号（双引号在两者里是字符串字面量）
    assert quote("store", "hive") == "`store`"
    assert quote("store", "impala") == "`store`"
    assert quote("dm.v_bangdan", "impala") == "`dm`.`v_bangdan`"
    # Presto / Oracle / Redshift（PG 协议）用双引号
    assert quote("store", "presto") == '"store"'
    assert quote("store", "oracle") == '"store"'
    assert quote("store", "postgresql") == '"store"'


def test_mysql_build_uses_backticks_like_and_no_nulls_last() -> None:
    built = build(
        _qo(
            dialect="mysql",
            table="dm.v_bangdan",
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "total"}],
            filters=[{"column": "store", "op": "=", "value": "A店"}],
            keyword={"columns": ["store"], "value": "旗舰"},
            order_by=[{"column": "total", "desc": True}],
        ),
        allowed_tables=ALLOWED,
    )
    sql = built.sql
    # FROM 的 schema 表名逐段反引号
    assert "FROM `dm`.`v_bangdan`" in sql
    assert "SELECT `store`, SUM(`revenue`) AS `total`" in sql
    assert "GROUP BY `store`" in sql
    assert "`store` LIKE :kw0" in sql
    assert "ILIKE" not in sql
    assert "NULLS LAST" not in sql
    # MySQL 没有 NULLS LAST：用 (col IS NULL) 前置排序键把空值排到最后（与 PG 口径一致）
    assert "ORDER BY `total` IS NULL, `total` DESC" in sql
    assert '"' not in sql
    # 值仍然绑定，不拼进 SQL
    assert "A店" not in sql
    assert built.params["f0"] == "A店"
    assert built.params["kw0"] == "%旗舰%"
    assert built.params["_limit"] == 500


def test_mysql_time_grain_uses_date_format() -> None:
    built = build(
        _qo(
            dialect="mysql",
            dimensions=[{"column": "dt", "grain": "month"}],
            metrics=[{"column": "gmv", "agg": "SUM", "alias": "g"}],
            order_by=[{"column": "dt", "desc": False}],
        ),
        allowed_tables=ALLOWED,
    )
    assert "DATE_FORMAT(`dt`, '%Y-%m-01')" in built.sql
    assert "GROUP BY DATE_FORMAT(`dt`, '%Y-%m-01')" in built.sql
    assert "date_trunc" not in built.sql
    # 按粒度表达式排序（不是别名）：MySQL / ClickHouse 会把别名解析成源列
    assert "ORDER BY DATE_FORMAT(`dt`, '%Y-%m-01') IS NULL, DATE_FORMAT(`dt`, '%Y-%m-01') ASC" in built.sql


def test_mssql_build_uses_brackets_and_no_nulls_last() -> None:
    built = build(
        _qo(
            dialect="mssql",
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "total"}],
            keyword={"columns": ["store", "person"], "value": "旗舰"},
            order_by=[{"column": "total", "desc": True}],
        ),
        allowed_tables=ALLOWED,
    )
    assert "SELECT [store], SUM([revenue]) AS [total]" in built.sql
    assert "[store] LIKE :kw0" in built.sql
    assert "[person] LIKE :kw1" in built.sql
    assert "ILIKE" not in built.sql
    assert "NULLS LAST" not in built.sql
    assert "`" not in built.sql


def test_postgres_keeps_ilike_and_nulls_last() -> None:
    built = build(
        _qo(
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "total"}],
            keyword={"columns": ["store"], "value": "旗舰"},
            order_by=[{"column": "total", "desc": True}],
        ),
        allowed_tables=ALLOWED,
    )
    assert '"store" ILIKE :kw0' in built.sql
    assert 'ORDER BY "total" DESC NULLS LAST' in built.sql
    assert "`" not in built.sql


def test_clickhouse_uses_double_quotes_and_ilike() -> None:
    built = build(
        _qo(
            dialect="clickhouse",
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "total"}],
            keyword={"columns": ["store"], "value": "旗舰"},
            order_by=[{"column": "total", "desc": False}],
        ),
        allowed_tables=ALLOWED,
    )
    assert 'SELECT "store", SUM("revenue") AS "total"' in built.sql
    assert '"store" ILIKE :kw0' in built.sql
    assert 'ORDER BY "total" ASC NULLS LAST' in built.sql
    assert "`" not in built.sql


def test_rls_and_filters_bound_on_mysql() -> None:
    built = build(
        _qo(
            dialect="mysql",
            dimensions=[{"column": "store"}],
            metrics=[{"column": "revenue", "agg": "SUM", "alias": "t"}],
            filters=[{"column": "person", "op": "IN", "value": ["a", "b"]}],
        ),
        allowed_tables=ALLOWED,
        rls_conditions=["store = 'A店'"],
    )
    assert "WHERE `person` IN (:f0_0, :f0_1)" in built.sql
    assert "(store = 'A店')" in built.sql
    assert built.sql.index("WHERE") < built.sql.index("GROUP BY")
    assert built.params["f0_0"] == "a"
    assert built.params["f0_1"] == "b"

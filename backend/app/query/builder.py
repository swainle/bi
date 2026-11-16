"""QueryObject → SQL（含参数绑定与行级权限下推）.

三条硬规则：
    1. 标识符只允许 [A-Za-z_][A-Za-z0-9_]*，一律加双引号
    2. 值一律走 :param 绑定，绝不字符串拼接
    3. 表必须在白名单内；行级条件 AND 进 WHERE（在 GROUP BY 之前）
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.query.column_types import needs_cast
from app.query.contract import FilterSpec, QueryObject
from app.query.grain import grain_expression, normalize_dialect
from app.query.whitelist import SOURCE_TABLE_PREFIXES
from app.security.errors import TableNotAllowedError


@dataclass
class BuiltQuery:
    sql: str
    params: dict = field(default_factory=dict)
    table: str = ""


def quote(ident: str, dialect: str = "postgresql") -> str:
    """标识符加引号（调用前必须已通过 contract 的标识符校验）.

    带 schema 的表名（直连模式如 dm.v_bangdan）逐段加引号，避免整体当成一个标识符。
    方言差异：MySQL / Hive / Impala 用反引号、SQL Server 用方括号，其余（PG / ClickHouse / Oracle…）用双引号。
    先经 `normalize_dialect` 收敛别名（postgresql→postgres、sqlserver/mssql→tsql、mariadb/doris→mysql），
    否则同一个库换个写法引号就错了。
    """
    family = normalize_dialect(dialect)
    if family in {"mysql", "hive", "impala"}:
        open_q, close_q = "`", "`"
    elif family == "tsql":
        open_q, close_q = "[", "]"
    else:
        open_q, close_q = '"', '"'
    return ".".join(f"{open_q}{part}{close_q}" for part in ident.split("."))


# 这些方言没有 ILIKE / NULLS LAST，直接生成会语法错误（MySQL 默认排序规则本身不区分大小写）
_NO_ILIKE = {"mysql", "tsql", "oracle", "ibm_db_sa", "presto", "hive", "impala"}
# Impala 的 ORDER BY 不支持 NULLS LAST（Hive 2.1+ / Db2 / Presto 支持）
_NO_NULLS_LAST = {"mysql", "tsql", "impala"}


# SUM / AVG 只对数值列成立；文本 / 时间列要先拦下来，别把 psycopg 的报错甩给用户
NUMERIC_AGGS = frozenset({"SUM", "AVG"})
NUMERIC_TYPES = frozenset({
    "smallint", "integer", "bigint", "numeric", "decimal",
    "real", "double precision", "float4", "float8", "money",
})


def _compile_filters(
    filters: list[FilterSpec],
    params: dict,
    prefix: str,
    dialect: str,
    types: dict[str, str] | None = None,
) -> list[str]:
    clauses: list[str] = []
    for idx, item in enumerate(filters):
        expr = (
            grain_expression(
                quote(item.column, dialect), item.grain, dialect,
                cast=needs_cast((types or {}).get(item.column)),
            )
            if item.grain
            else quote(item.column, dialect)
        )
        op = item.op
        if op in ("IS NULL", "IS NOT NULL"):
            clauses.append(f"{expr} {op}")
            continue

        if op in ("IN", "NOT IN"):
            values = item.value if isinstance(item.value, list) else [item.value]
            keys = []
            for pos, value in enumerate(values):
                key = f"{prefix}{idx}_{pos}"
                params[key] = value
                keys.append(f":{key}")
            clauses.append(f"{expr} {op} ({', '.join(keys)})")
        elif op == "BETWEEN":
            values = item.value if isinstance(item.value, (list, tuple)) else []
            if len(values) < 2:
                raise ValueError("BETWEEN 需要两个值")
            lo, hi = f"{prefix}{idx}_lo", f"{prefix}{idx}_hi"
            params[lo] = values[0]
            params[hi] = values[1]
            clauses.append(f"{expr} BETWEEN :{lo} AND :{hi}")
        else:
            key = f"{prefix}{idx}"
            params[key] = item.value
            clauses.append(f"{expr} {op} :{key}")
    return clauses


def build(
    query: QueryObject,
    *,
    allowed_tables: set[str] | None = None,
    rls_conditions: list[str] | None = None,
    column_types: dict[str, str] | None = None,
) -> BuiltQuery:
    """编译成一个可直接执行的 BuiltQuery."""
    dialect = query.dialect
    family = normalize_dialect(dialect)
    table = query.table
    if query.subquery:
        # 虚拟数据集：SQL 在保存时已过只读网关 + 表白名单，这里不再重复校验
        from_clause = f"({query.subquery}) AS {quote('__ds', dialect)}"
    else:
        if allowed_tables is not None and table not in allowed_tables \
                and not table.startswith(SOURCE_TABLE_PREFIXES):
            # 数据源同步表 / 文件导入表由接入层创建，前缀即白名单
            raise TableNotAllowedError([table])
        from_clause = quote(table, dialect)

    params: dict = {}
    has_metric = bool(query.metrics)

    types = column_types or {}
    select_parts: list[str] = []
    for dim in query.dimensions:
        alias = quote(dim.output_name, dialect)
        if dim.grain:
            select_parts.append(
                f"{grain_expression(quote(dim.column, dialect), dim.grain, dialect, cast=needs_cast(types.get(dim.column)))} AS {alias}"
            )
        elif dim.alias and dim.alias != dim.column:
            select_parts.append(f"{quote(dim.column, dialect)} AS {alias}")
        else:
            select_parts.append(alias)

    for col in query.columns:
        alias = quote(col.alias or col.column, dialect)
        if col.alias and col.alias != col.column:
            select_parts.append(f"{quote(col.column, dialect)} AS {alias}")
        else:
            select_parts.append(alias)

    for metric in query.metrics:
        if not metric.expression and metric.agg in NUMERIC_AGGS:
            data_type = (types.get(metric.column or "") or "").lower()
            if data_type and data_type not in NUMERIC_TYPES:
                raise ValueError(
                    f"字段「{metric.column}」是 {data_type} 类型，{metric.agg} 用不了；"
                    f"改用 COUNT / COUNT_DISTINCT，或换成数值列"
                )
        if metric.expression:
            # 语义层定义的表达式（管理员维护，已在建模时校验）
            select_parts.append(f'{metric.expression} AS {quote(metric.output_name, dialect)}')
        else:
            col = quote(metric.require_column(), dialect)
            if metric.agg == "COUNT_DISTINCT":
                select_parts.append(f'COUNT(DISTINCT {col}) AS {quote(metric.output_name, dialect)}')
            else:
                select_parts.append(f'{metric.agg}({col}) AS {quote(metric.output_name, dialect)}')

    if not select_parts:
        select_parts.append("COUNT(*) AS count")

    where_clauses = _compile_filters(query.filters, params, "f", dialect, types)
    # 跨列模糊搜索：任一列命中即可（OR），整体再与其它条件 AND
    if query.keyword and query.keyword.value.strip() and query.keyword.columns:
        parts: list[str] = []
        like_op = "LIKE" if family in _NO_ILIKE else "ILIKE"
        for pos, column in enumerate(query.keyword.columns):
            key = f"kw{pos}"
            params[key] = f"%{query.keyword.value.strip()}%"
            parts.append(f"{quote(column, dialect)} {like_op} :{key}")
        where_clauses.append("(" + " OR ".join(parts) + ")")
    where_clauses.extend(f"({c})" for c in (rls_conditions or []))

    having_clauses = _compile_filters(query.having, params, "h", dialect)

    order_parts: list[str] = []
    # 时间粒度维度在 SELECT 里是表达式（别名可能与源列同名）。MySQL / ClickHouse 的
    # `ORDER BY 别名` 会解析成源列（前者 ONLY_FULL_GROUP_BY 报错、后者 NOT_AN_AGGREGATE），
    # 所以按「粒度表达式」排序，而不是别名。
    grain_exprs = {
        d.output_name: grain_expression(
            quote(d.column, dialect), d.grain, dialect, cast=needs_cast(types.get(d.column))
        )
        for d in query.dimensions if d.grain
    }
    for order in query.order_by:
        # NULLS LAST：PostgreSQL 的 DESC 默认 NULLS FIRST，会把空值排到最前面，
        # 导致「取最大值」拿到一整页 NULL（搜索增速 / 需求供给比都踩过）。
        # MySQL / SQL Server 不支持该语法 → 用 (col IS NULL) 当第一排序键，效果等价。
        expr = grain_exprs.get(order.column) or quote(order.column, dialect)
        direction = "DESC" if order.desc else "ASC"
        if family in _NO_NULLS_LAST:
            order_parts.append(f"{expr} IS NULL, {expr} {direction}")
        else:
            order_parts.append(f"{expr} {direction} NULLS LAST")

    sql = f"SELECT {', '.join(select_parts)} FROM {from_clause}"
    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)
    if has_metric and query.dimensions:
        sql += " GROUP BY " + ", ".join(
            grain_expression(quote(d.column, dialect), d.grain, dialect, cast=needs_cast(types.get(d.column)))
            if d.grain else quote(d.column, dialect)
            for d in query.dimensions
        )
    if having_clauses:
        sql += " HAVING " + " AND ".join(having_clauses)
    if order_parts:
        sql += " ORDER BY " + ", ".join(order_parts)
    sql += " LIMIT :_limit OFFSET :_offset"
    params["_limit"] = query.limit
    params["_offset"] = query.offset

    return BuiltQuery(sql=sql, params=params, table=table)


__all__ = ["build", "BuiltQuery", "quote"]

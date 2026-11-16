"""时间粒度 —— 把「月 / 周 / 季」翻译成各方言的表达式.

为什么不能只写 date_trunc：
    PG / MySQL / ClickHouse / SQL Server / Oracle 的写法完全不同，
    而 BI 的「按月看」必须下推到 SQL（不能拉回 Python 再聚合）。
"""

from __future__ import annotations

from app.security.errors import SecurityError

GRAINS: tuple[str, ...] = ("hour", "day", "week", "month", "quarter", "year")

# 方言 → 粒度表达式模板（{col} 会被替换成已校验的列引用）
_EXPRESSIONS: dict[str, dict[str, str]] = {
    "postgres": {
        "hour": "date_trunc('hour', {col})",
        "day": "date_trunc('day', {col})",
        "week": "date_trunc('week', {col})",
        "month": "date_trunc('month', {col})",
        "quarter": "date_trunc('quarter', {col})",
        "year": "date_trunc('year', {col})",
    },
    "mysql": {
        "hour": "DATE_FORMAT({col}, '%Y-%m-%d %H:00:00')",
        "day": "DATE_FORMAT({col}, '%Y-%m-%d')",
        "week": "DATE_SUB(DATE_FORMAT({col}, '%Y-%m-%d'), INTERVAL WEEKDAY({col}) DAY)",
        "month": "DATE_FORMAT({col}, '%Y-%m-01')",
        "quarter": "CONCAT(YEAR({col}), '-', LPAD(QUARTER({col}) * 3 - 2, 2, '0'), '-01')",
        "year": "DATE_FORMAT({col}, '%Y-01-01')",
    },
    "clickhouse": {
        "hour": "toStartOfHour({col})",
        "day": "toStartOfDay({col})",
        "week": "toStartOfWeek({col})",
        "month": "toStartOfMonth({col})",
        "quarter": "toStartOfQuarter({col})",
        "year": "toStartOfYear({col})",
    },
    "tsql": {
        "hour": "DATEADD(hour, DATEDIFF(hour, 0, {col}), 0)",
        "day": "CAST({col} AS DATE)",
        "week": "DATEADD(week, DATEDIFF(week, 0, {col}), 0)",
        "month": "DATEFROMPARTS(YEAR({col}), MONTH({col}), 1)",
        "quarter": "DATEFROMPARTS(YEAR({col}), (MONTH({col}) - 1) / 3 * 3 + 1, 1)",
        "year": "DATEFROMPARTS(YEAR({col}), 1, 1)",
    },
    "oracle": {
        "hour": "TRUNC({col}, 'HH')",
        "day": "TRUNC({col}, 'DD')",
        "week": "TRUNC({col}, 'IW')",
        "month": "TRUNC({col}, 'MM')",
        "quarter": "TRUNC({col}, 'Q')",
        "year": "TRUNC({col}, 'YYYY')",
    },
    # Presto / Trino：date_trunc 与 PostgreSQL 同形
    "presto": {
        "hour": "date_trunc('hour', {col})",
        "day": "date_trunc('day', {col})",
        "week": "date_trunc('week', {col})",
        "month": "date_trunc('month', {col})",
        "quarter": "date_trunc('quarter', {col})",
        "year": "date_trunc('year', {col})",
    },
}

# 暂未适配时间粒度的方言：宁可明确报错，也不静默回退 PG 生成错 SQL
_UNSUPPORTED_DIALECTS = {"hive", "impala", "ibm_db_sa"}

# 常见别名收敛
_DIALECT_ALIASES = {
    "postgresql": "postgres",
    "pg": "postgres",
    "mariadb": "mysql",
    "mssql": "tsql",
    "sqlserver": "tsql",
    "sql_server": "tsql",
    "doris": "mysql",
    "starrocks": "mysql",
    "tidb": "mysql",
}


class UnsupportedGrainError(SecurityError):
    code = "grain_unsupported"


def normalize_dialect(dialect: str | None) -> str:
    if not dialect:
        return "postgres"
    key = dialect.strip().lower()
    return _DIALECT_ALIASES.get(key, key)


def validate_grain(grain: str | None) -> str | None:
    """校验粒度取值（None 表示不按时间聚合）."""
    if grain is None or grain == "":
        return None
    value = str(grain).strip().lower()
    if value not in GRAINS:
        raise UnsupportedGrainError(f"不支持的粒度：{grain}（可选 {', '.join(GRAINS)}）")
    return value


def cast_to_timestamp(column_sql: str, dialect: str = "postgres") -> str:
    """把文本日期列强制转成时间类型（各库写法不同）."""
    key = normalize_dialect(dialect)
    if key == "postgres":
        return f"({column_sql})::timestamp"
    if key == "clickhouse":
        return f"toDateTimeOrNull({column_sql})"
    if key == "oracle":
        return f"TO_DATE({column_sql}, 'YYYY-MM-DD')"
    if key == "tsql":
        return f"CAST({column_sql} AS datetime2)"
    return column_sql  # MySQL 的 DATE_FORMAT 接受字符串，无需转换


def grain_expression(
    column_sql: str,
    grain: str,
    dialect: str = "postgres",
    *,
    cast: bool = False,
) -> str:
    """生成带粒度的列表达式；方言不认识时回退 PG 语义.

    Args:
        cast: 当列本身不是时间类型（例如 text 存日期）时置 True
    """
    value = validate_grain(grain)
    if value is None:
        return column_sql
    key = normalize_dialect(dialect)
    # 这几个方言没有可用的 date_trunc 写法，静默回退 PG 会生成必然失败的 SQL
    if key in _UNSUPPORTED_DIALECTS:
        raise UnsupportedGrainError(f"{dialect} 暂未适配时间粒度，请先按明细或不聚合时间")
    expr = cast_to_timestamp(column_sql, dialect) if cast else column_sql
    table = _EXPRESSIONS.get(key, _EXPRESSIONS["postgres"])
    template = table.get(value)
    if not template:
        raise UnsupportedGrainError(f"方言 {dialect} 不支持粒度 {value}")
    return template.format(col=expr)


def supported_grains() -> list[str]:
    return list(GRAINS)


__all__ = [
    "GRAINS",
    "cast_to_timestamp",
    "UnsupportedGrainError",
    "validate_grain",
    "grain_expression",
    "normalize_dialect",
    "supported_grains",
]

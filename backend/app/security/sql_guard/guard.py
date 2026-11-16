"""SQL 只读网关 —— 对外唯一入口.

用法：
    from app.security.sql_guard import guard_readonly
    expr = guard_readonly(sql, allowed_tables=ALLOWED_TABLES)

上层只依赖本模块，内部拆成 parser / tables 两个文件，
任何一处调整都不影响路由代码。
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

from app.security.sql_guard.parser import parse_readonly
from app.security.sql_guard.tables import (
    assert_tables_allowed,
    referenced_tables,
    resolve_target_tables,
)

DEFAULT_DIALECT = "postgres"


def guard_readonly(
    sql: str,
    *,
    allowed_tables: set[str] | None = None,
    allow_prefixes: tuple[str, ...] = (),
    dialect: str | None = DEFAULT_DIALECT,
) -> exp.Expression:
    """校验并返回只读 AST.

    Args:
        sql: 待校验 SQL
        allowed_tables: 表白名单；None 表示不限表（仍校验只读）
        allow_prefixes: 允许的表名前缀（如 ("bi_ai_",)）
        dialect: sqlglot 方言

    Raises:
        SecurityError 子类：SqlSyntaxError / NotReadOnlyError /
                            TableNotAllowedError / UnsafeFunctionError
    """
    root = parse_readonly(sql, dialect=dialect)
    if allowed_tables is not None:
        tables = referenced_tables(root)
        assert_tables_allowed(tables, allowed_tables, allow_prefixes=allow_prefixes)
    return root


def governed_tables(
    root: exp.Expression,
    allowed_tables: set[str],
    *,
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """返回本次查询涉及的受管辖表（供行级权限逐表套用）."""
    return resolve_target_tables(
        referenced_tables(root),
        allowed_tables,
        allow_prefixes=allow_prefixes,
    )


def to_sql(root: exp.Expression, dialect: str = DEFAULT_DIALECT) -> str:
    """AST 回写成 SQL 字符串."""
    return root.sql(dialect=dialect)


def parse_condition(text: str, dialect: str = DEFAULT_DIALECT) -> exp.Expression:
    """把一段「只有条件」的文本解析成 WHERE 条件表达式（行级权限用）."""
    probe = f"SELECT 1 WHERE {text}"
    root = sqlglot.parse_one(probe, read=dialect)
    where = root.args.get("where")
    if where is None:
        raise ValueError(f"无法解析条件：{text}")
    return where.this


__all__ = [
    "guard_readonly",
    "governed_tables",
    "to_sql",
    "parse_condition",
    "DEFAULT_DIALECT",
]

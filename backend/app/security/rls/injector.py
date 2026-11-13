"""把规则注入 SQL —— 两种注入点.

1. 单层 SELECT：直接 AND 到它自己的 WHERE（在 GROUP BY 之前生效，
   聚合结果才是正确的 —— 这是行级权限必须下推的原因）
2. UNION / 子查询等复合形态：外包一层 WHERE（行级语义仍正确）

绝不使用「查完再在 Python 里过滤」：那样 LIMIT / 聚合 / 分页全部失真。
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

from app.security.sql_guard import parse_condition, parse_readonly


def combine(conditions: list[str], dialect: str = "postgres") -> exp.Expression | None:
    """多个条件用 AND 合并成一个表达式."""
    parsed = [parse_condition(c, dialect=dialect) for c in conditions if c and c.strip()]
    if not parsed:
        return None
    combined = parsed[0]
    for extra in parsed[1:]:
        combined = exp.and_(combined, extra)
    return combined


def inject_conditions(
    sql: str,
    conditions: list[str],
    dialect: str = "postgres",
) -> str:
    """返回注入行级条件后的 SQL 字符串（不改变语义，只收窄可见行）."""
    if not conditions:
        return sql

    root = parse_readonly(sql, dialect=dialect)
    combined = combine(conditions, dialect=dialect)
    if combined is None:
        return sql

    if isinstance(root, exp.Select):
        injected = root.where(combined, append=True)
        return injected.sql(dialect=dialect)

    # UNION / INTERSECT / EXCEPT：外层过滤（列须出现在输出中）
    wrapped = exp.select("*").from_(root.subquery(alias="_rls_src")).where(combined)
    return wrapped.sql(dialect=dialect)


def where_fragment(conditions: list[str]) -> str:
    """给手写 SQL 的构造器用：返回 "(a) AND (b)" 片段，无规则返回空串."""
    items = [f"({c.strip()})" for c in conditions if c and c.strip()]
    return " AND ".join(items)

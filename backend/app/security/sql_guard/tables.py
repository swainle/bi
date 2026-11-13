"""表名提取与白名单校验.

CTE（WITH x AS ...）定义的临时名不算真实表，必须排除，
否则「先建 CTE 再查白名单表」这种写法会被误判。
"""

from __future__ import annotations

from sqlglot import exp

from app.security.errors import TableNotAllowedError


def cte_names(root: exp.Expression) -> set[str]:
    """收集 CTE 别名（小写）."""
    names: set[str] = set()
    for cte in root.find_all(exp.CTE):
        alias = cte.args.get("alias")
        if alias is not None:
            name = alias.this if isinstance(alias, exp.TableAlias) else alias
            names.add(str(name).strip('"').lower())
    return names


def referenced_tables(root: exp.Expression) -> set[str]:
    """提取 SQL 实际引用的表名（小写、去 schema 前缀、排除 CTE）."""
    skip = cte_names(root)
    tables: set[str] = set()
    for table in root.find_all(exp.Table):
        name = (table.name or "").strip().strip('"').lower()
        if not name or name in skip:
            continue
        tables.add(name)
    return tables


def assert_tables_allowed(
    tables: set[str],
    allowed: set[str],
    *,
    allow_prefixes: tuple[str, ...] = (),
) -> None:
    """所有被引用的表都必须在白名单内（或命中允许的前缀）.

    Raises:
        TableNotAllowedError: 存在越权表
    """
    if not allowed and not allow_prefixes:
        return

    illegal = [
        t
        for t in tables
        if t not in allowed and not t.startswith(allow_prefixes)
    ]
    if illegal:
        raise TableNotAllowedError(illegal)


def resolve_target_tables(
    tables: set[str],
    allowed: set[str],
    *,
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """把引用表收敛成「受管辖的表」—— 用于批量套用行级权限."""
    return [
        t
        for t in sorted(tables)
        if t in allowed or t.startswith(allow_prefixes)
    ]


__all__ = [
    "cte_names",
    "referenced_tables",
    "assert_tables_allowed",
    "resolve_target_tables",
]

"""只读 SQL 解析器 —— sqlglot 的薄封装.

职责边界（单一）：
    把一段字符串变成 AST，并保证它是「单条、只读、无危险函数」的查询。

不做的事：源表识别（tables.py）、行级权限注入（rls 包）。
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

from app.security.denylist import DANGEROUS_FUNCS, WRITE_NODE_NAMES
from app.security.errors import (
    NotReadOnlyError,
    SqlSyntaxError,
    UnsafeFunctionError,
)

# 允许作为顶层语句的只读形态
_READONLY_ROOTS = (
    exp.Select,
    exp.Union,
    exp.Intersect,
    exp.Except,
    exp.Subquery,
)

# 出现即拒绝的写操作节点（用 getattr 兼容不同 sqlglot 版本）
_WRITE_NODES = tuple(
    node
    for node in (getattr(exp, name, None) for name in WRITE_NODE_NAMES)
    if node is not None
)

# 允许调用的函数：命中即拒绝（读文件 / 睡眠 / 提权 / 外部连接）
_DANGEROUS_FUNCS = DANGEROUS_FUNCS


def parse_readonly(sql: str, dialect: str | None = "postgres") -> exp.Expression:
    """解析单条只读 SQL，返回 AST.

    Args:
        dialect: sqlglot 方言；传 None 表示自动识别（对接外部数据源时用）

    Raises:
        SqlSyntaxError: 无法解析 / 空语句 / 多语句
        NotReadOnlyError: 顶层不是 SELECT 家族，或含写操作节点
        UnsafeFunctionError: 调用了危险函数
    """
    text = (sql or "").strip().rstrip(";").strip()
    if not text:
        raise SqlSyntaxError("SQL 不能为空")

    try:
        statements = sqlglot.parse(text, read=dialect)
    except Exception as exc:  # sqlglot 抛的异常类型不稳定，统一收口
        raise SqlSyntaxError("SQL 无法解析", detail=str(exc)[:200]) from exc

    statements = [s for s in statements if s is not None]
    if not statements:
        raise SqlSyntaxError("SQL 无法解析")
    if len(statements) > 1:
        raise NotReadOnlyError("不允许多条语句")

    root = statements[0]
    if not isinstance(root, _READONLY_ROOTS):
        raise NotReadOnlyError(f"仅允许 SELECT 查询，实际为 {type(root).__name__}")

    # SELECT ... INTO new_table 是写操作
    if isinstance(root, exp.Select) and root.args.get("into"):
        raise NotReadOnlyError("不允许 SELECT INTO")

    for node in root.walk():
        if isinstance(node, _WRITE_NODES):
            raise NotReadOnlyError(f"禁止 {type(node).__name__.upper()} 语句")
        if isinstance(node, (exp.Func, exp.Anonymous)):
            name = _func_name(node)
            if name and name.lower() in _DANGEROUS_FUNCS:
                raise UnsafeFunctionError(f"禁止调用函数 {name}")

    return root


def _func_name(node: exp.Expression) -> str:
    """取函数名 —— 兼容 Func / Anonymous / 带 schema 前缀的写法."""
    if isinstance(node, exp.Anonymous):
        return str(node.this or "")
    try:
        return node.sql_name()
    except Exception:
        return type(node).__name__


__all__ = ["parse_readonly"]

"""规则编译器 —— 把管理员填的一行条件文本变成可信的 AST 条件.

三层防线：
    1. 语法：sqlglot 能解析成 WHERE 条件
    2. 结构：禁止子查询、表引用、写操作
    3. 函数：复用全局危险函数黑名单
"""

from __future__ import annotations

from sqlglot import exp

from app.security.denylist import DANGEROUS_FUNCS, WRITE_NODE_NAMES
from app.security.errors import RuleCompileError
from app.security.sql_guard import parse_condition

_WRITE_NODES = tuple(
    node
    for node in (getattr(exp, name, None) for name in WRITE_NODE_NAMES)
    if node is not None
)

# 条件里不允许出现的节点（子查询一律禁止）
_FORBIDDEN_NODES = (
    exp.Select,
    exp.Subquery,
    exp.Table,
    exp.CTE,
) + _WRITE_NODES


def compile_condition(text: str, dialect: str = "postgres") -> exp.Expression:
    """校验并返回条件表达式.

    Raises:
        RuleCompileError: 规则不合法（管理员填写错误）
    """
    rule = (text or "").strip().rstrip(";").strip()
    if not rule:
        raise RuleCompileError("规则不能为空")
    if ";" in rule:
        raise RuleCompileError("规则中不允许出现分号")

    try:
        condition = parse_condition(rule, dialect=dialect)
    except ValueError as exc:
        raise RuleCompileError(f"规则无法解析：{rule[:60]}", detail=str(exc)[:200]) from exc
    except Exception as exc:  # sqlglot 内部异常类型不稳定
        raise RuleCompileError(f"规则无法解析：{rule[:60]}", detail=str(exc)[:200]) from exc

    for node in condition.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            raise RuleCompileError(
                f"规则中不允许 {type(node).__name__}（禁止子查询 / 写操作）"
            )
        if isinstance(node, (exp.Func, exp.Anonymous)):
            name = _func_name(node).lower()
            if name in DANGEROUS_FUNCS:
                raise RuleCompileError(f"规则中不允许调用函数 {name}")

    if not _mentions_column(condition):
        raise RuleCompileError("规则至少需要引用一个列，例如：store_id = 3")

    return condition


def compile_rule_text(text: str, dialect: str = "postgres") -> str:
    """校验后回写成规范化 SQL 片段（用于存库前把关）."""
    return compile_condition(text, dialect=dialect).sql(dialect=dialect)


def _mentions_column(condition: exp.Expression) -> bool:
    return any(isinstance(node, exp.Column) for node in condition.walk())


def _func_name(node: exp.Expression) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.this or "")
    try:
        return node.sql_name()
    except Exception:
        return type(node).__name__


__all__ = ["compile_condition", "compile_rule_text"]

"""语义层校验 —— 建模时把关，避免坏定义留到查询期.

三类校验：
    1. 物理表/列必须真实存在（information_schema）
    2. 指标表达式必须是「聚合 + 列运算」，禁止子查询与写操作
    3. role / format 取值收敛
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.semantic.models import FIELD_ROLES, METRIC_FORMATS
from app.security.denylist import DANGEROUS_FUNCS
from app.security.errors import SecurityError

_AGG_NAMES = {"sum", "avg", "min", "max", "count", "stddev", "variance"}


class SemanticError(SecurityError):
    code = "semantic_invalid"


def validate_role(role: str) -> str:
    value = (role or "dimension").strip().lower()
    if value not in FIELD_ROLES:
        raise SemanticError(f"字段角色不合法：{role}（可选 {', '.join(FIELD_ROLES)}）")
    return value


def validate_format(fmt: str) -> str:
    value = (fmt or "number").strip().lower()
    if value not in METRIC_FORMATS:
        raise SemanticError(f"指标格式不合法：{fmt}（可选 {', '.join(METRIC_FORMATS)}）")
    return value


def physical_columns(db: Session, table: str) -> set[str]:
    rows = db.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :t"
        ),
        {"t": table},
    ).fetchall()
    return {r[0] for r in rows}


def validate_table(db: Session, table: str) -> None:
    if not physical_columns(db, table):
        raise SemanticError(f"物理表不存在：{table}")


def validate_source_column(db: Session, table: str, column: str) -> str:
    cols = physical_columns(db, table)
    if column not in cols:
        raise SemanticError(f"列 {column} 不在表 {table} 中")
    return column


def validate_metric_expression(expression: str) -> str:
    """指标表达式必须是聚合表达式（可含算术），禁止子查询 / 写操作."""
    raw = (expression or "").strip()
    if not raw:
        raise SemanticError("指标表达式不能为空")
    if ";" in raw:
        raise SemanticError("指标表达式不允许出现分号")

    try:
        root = sqlglot.parse_one(f"SELECT {raw}", read="postgres")
    except Exception as exc:
        raise SemanticError(f"指标表达式无法解析：{raw[:60]}") from exc

    has_aggregate = False
    for node in root.walk():
        if isinstance(node, (exp.Select, exp.Subquery, exp.Table)):
            if isinstance(node, exp.Select) and node is root:
                continue
            raise SemanticError("指标表达式不允许子查询 / 表引用")
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create)):
            raise SemanticError("指标表达式不允许写操作")
        if isinstance(node, (exp.Func, exp.Anonymous)):
            name = _func_name(node).lower()
            if name in DANGEROUS_FUNCS:
                raise SemanticError(f"指标表达式不允许调用 {name}")
            if name in _AGG_NAMES:
                has_aggregate = True

    if not has_aggregate:
        raise SemanticError("指标表达式必须包含聚合函数，例如 SUM(revenue)")
    return raw


def _func_name(node: exp.Expression) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.this or "")
    try:
        return node.sql_name()
    except Exception:
        return type(node).__name__


__all__ = [
    "SemanticError",
    "validate_role",
    "validate_format",
    "validate_table",
    "validate_source_column",
    "validate_metric_expression",
    "physical_columns",
]

"""行级权限对外唯一入口 —— 路由只跟这一个模块打交道.

设计要点：
    * fail-closed：规则存在但编译失败 → blocked，宁可 403 也不放数据
    * 无规则 → 零开销（空 decision，不改 SQL、不改缓存键）
    * 只读 DB、不写、不缓存 AST，避免跨请求污染
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.security.errors import RlsBlockedError, RuleCompileError
from app.security.rls.compiler import compile_condition
from app.security.rls.fingerprint import fingerprint as make_fingerprint
from app.security.rls.injector import inject_conditions, where_fragment
from app.security.rls.models import RlsDecision
from app.security.rls.repository import load_rules

_EMPTY = RlsDecision(conditions=(), fingerprint="-")


def decide(db: Session, table: str, user: Any, dialect: str = "postgres") -> RlsDecision:
    """计算某张表对当前用户的行级权限结论."""
    rules = load_rules(db, table, user)
    if not rules:
        return _EMPTY

    validated: list[str] = []
    for rule in rules:
        try:
            compile_condition(rule.filter_rule, dialect=dialect)
        except RuleCompileError as exc:
            # 规则本身坏了 → 不能降级成"看全部"，直接封死这张表
            raise RlsBlockedError(
                f"行级权限规则无效（{rule.scope}）：{exc.message}",
                detail=f"table={table}",
            ) from exc
        validated.append(rule.filter_rule.strip())

    if not validated:
        return _EMPTY

    return RlsDecision(
        conditions=tuple(validated),
        fingerprint=make_fingerprint(validated),
    )


def apply_to_sql(sql: str, decision: RlsDecision, dialect: str = "postgres") -> str:
    """把结论注入到一条 SQL."""
    if decision.blocked or not decision.conditions:
        return sql
    return inject_conditions(sql, list(decision.conditions), dialect=dialect)


def where_sql(decision: RlsDecision) -> str:
    """给手写 SQL 的构造器用."""
    if decision.blocked or not decision.conditions:
        return ""
    return where_fragment(list(decision.conditions))


__all__ = ["decide", "apply_to_sql", "where_sql", "RlsDecision"]

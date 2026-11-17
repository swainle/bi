"""BI 引擎 · 查询构建与只读 SQL（/query_builder、/query）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.security.nav_guard import require_nav
from app.middleware.auth import get_current_user
from app.models.user import User
from app.security.errors import RlsBlockedError, SecurityError
from app.security.rls import decide as rls_decide
from app.security.rls.injector import inject_conditions
from app.security.sql_guard import guard_readonly, referenced_tables
from app.query.whitelist import ALLOWED_TABLES

from fastapi import APIRouter

router = APIRouter()

from .common import _FILTER_OPS, _JOIN_TYPES, _apply_masks, _order_clause, _validate_agg, _validate_col, _validate_join_on, _validate_limit

@router.post("/query_builder")
def query_builder(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """自助分析查询构建器。
    参数: {
      table: "bi_finance",
      metrics: [{"col":"revenue","agg":"SUM","alias":"总收入"}],
      dimensions: ["month"],
      filters: [{"col":"revenue","op":">","val":2000000}],
      order_by: "month ASC",
      limit: 500
    }
    自动生成 SQL 并执行。
    """
    table = payload["table"]
    if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
        raise HTTPException(404, f"表 {table} 不在白名单中")

    # 多表 JOIN 支持
    joins = payload.get("joins", [])
    from_clause = table
    if joins:
        for j in joins:
            jt = str(j["table"])
            j_type = str(j.get("type", "INNER")).strip().upper()
            if j_type not in _JOIN_TYPES:
                raise HTTPException(400, f"不支持的 JOIN 类型: {j.get('type')}")
            if jt not in ALLOWED_TABLES:
                raise HTTPException(404, f"JOIN 表 {jt} 不在白名单中")
            j_on = _validate_join_on(j.get("on"))
            from_clause += f" {j_type} JOIN {jt} ON {j_on}"

    metrics = payload.get("metrics", [])
    dimensions = payload.get("dimensions", [])
    filters = payload.get("filters", [])
    order_by = payload.get("order_by", "")
    limit = _validate_limit(payload.get("limit", 500))

    # Build SELECT（维度支持时间粒度：字符串=列名，字典={"column","grain"}）
    from app.query.column_types import column_types as _col_types, needs_cast
    from app.query.grain import grain_expression

    _types = _col_types(db, table)
    select_parts = []
    dim_exprs: list[str] = []
    for d in dimensions:
        if isinstance(d, dict):
            col = str(d.get("column", ""))
            grain = d.get("grain")
        else:
            col, grain = str(d), None
        _validate_col(col)
        if grain:
            expr = grain_expression(f'"{col}"', grain, cast=needs_cast(_types.get(col)))
            select_parts.append(f'{expr} AS "{col}"')
            dim_exprs.append(expr)
        else:
            select_parts.append(f'"{col}"')
            dim_exprs.append(f'"{col}"')
    if not metrics:
        select_parts.append("count(*) AS count")
    else:
        for m in metrics:
            col = str(m["col"])
            agg = _validate_agg(m.get("agg", "SUM"))
            alias = str(m.get("alias", f"{agg}_{col}"))
            _validate_col(col)
            _validate_col(alias)
            select_parts.append(f'{agg}("{col}") AS "{alias}"')

    # Build GROUP BY / FROM / WHERE
    group_clause = ""
    if dim_exprs:
        group_clause = "GROUP BY " + ", ".join(dim_exprs)

    where_clauses = []
    params: dict = {}
    for idx, f in enumerate(filters):
        col = str(f["col"])
        op = str(f["op"]).upper().strip()
        val = f["val"]
        _validate_col(col)
        if op not in _FILTER_OPS:
            raise HTTPException(400, f"不支持的筛选运算符: {op}")

        # 值一律走绑定参数（不再拼进 SQL 字符串）
        if op in ("IN", "NOT IN"):
            seq = val if isinstance(val, list) else [val]
            keys = []
            for pos, item in enumerate(seq):
                key = f"f{idx}_{pos}"
                params[key] = item
                keys.append(f":{key}")
            where_clauses.append(f'"{col}" {op} ({", ".join(keys)})')
        elif op == "BETWEEN":
            lo, hi = f"f{idx}_lo", f"f{idx}_hi"
            params[lo] = val[0]
            params[hi] = val[1]
            where_clauses.append(f'"{col}" BETWEEN :{lo} AND :{hi}')
        else:
            key = f"f{idx}"
            params[key] = val
            where_clauses.append(f'"{col}" {op} :{key}')

    # 行级权限（主表 + JOIN 表）：条件已在编译期校验，这里只做 AND
    rls_conditions: list[str] = []
    try:
        for t in dict.fromkeys([table] + [str(j["table"]) for j in joins]):
            rls_conditions.extend(rls_decide(db, t, current_user).conditions)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    where_clauses.extend(f"({c})" for c in rls_conditions)

    where_clause = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    first_dim = ""
    if dimensions:
        first_dim = (
            str(dimensions[0].get("column", ""))
            if isinstance(dimensions[0], dict)
            else str(dimensions[0])
        )
    order_clause = _order_clause(order_by) or (f'ORDER BY "{first_dim}"' if first_dim else "")

    sql = f"""SELECT {", ".join(select_parts)} FROM {from_clause}
{where_clause} {group_clause} {order_clause} LIMIT {limit}"""

    try:
        rows = db.execute(text(sql), params).fetchall()
        if not rows:
            return {"sql": sql, "columns": [], "rows": [], "count": 0}
        columns = list(rows[0]._mapping.keys())
        return {"sql": sql, "columns": columns, "rows": _apply_masks(payload["table"], [dict(r._mapping) for r in rows], db), "count": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"查询错误: {str(e)}\nSQL: {sql}")


def _validate_sql(sql: str):
    """只读校验 —— 交给安全内核（sqlglot AST），不再用正则黑名单。

    返回 AST 供调用方复用（表白名单 + 行级权限都要用它）。
    兼容旧口径：至少引用一张受管辖表（白名单 或 bi_ai_* 前缀）。
    """
    try:
        root = guard_readonly(sql)
    except SecurityError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    tables = referenced_tables(root)
    if not (tables & ALLOWED_TABLES) and not any(
        t.startswith("bi_ai_") for t in tables
    ):
        raise HTTPException(
            400, f"查询表必须在白名单内: {', '.join(sorted(ALLOWED_TABLES))}"
        )
    return root


def _query_rls_conditions(db: Session, tables: set[str], user: User) -> list[str]:
    """把多张表的行级规则合并（用于手拼 SQL 的查询入口）."""
    conditions: list[str] = []
    for table in sorted(tables):
        if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
            continue
        decision = rls_decide(db, table, user)
        conditions.extend(decision.conditions)
    return conditions


@router.post("/query", dependencies=[Depends(require_nav("bi:nav:sql"))])
def execute_sql(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行 SQL 查询（仅限 SELECT，白名单表）"""
    sql = payload.get("sql", "").strip()
    if not sql:
        raise HTTPException(400, "SQL 不能为空")
    root = _validate_sql(sql)

    # 行级权限：把受管辖表的规则 AND 进 WHERE（fail-closed）
    try:
        conditions = _query_rls_conditions(db, referenced_tables(root), current_user)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    if conditions:
        sql = inject_conditions(sql, conditions)

    try:
        rows = db.execute(text(sql), {"uid": current_user.id}).fetchall()
        if not rows:
            return {"columns": [], "rows": [], "count": 0}
        columns = list(rows[0]._mapping.keys())
        return {"columns": columns, "rows": [dict(r._mapping) for r in rows], "count": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL 错误: {str(e)}")

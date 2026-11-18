"""SQL Lab 与虚拟数据集共用只读校验、源表行级权限和有限预览。"""

import time

from sqlalchemy import text
from sqlglot import exp
from sqlglot.optimizer.scope import traverse_scope

from app.query.table_catalog import SYSTEM_TABLES, is_queryable
from app.security.errors import SqlSyntaxError, TableNotAllowedError
from app.security.rls import decide
from app.security.rls.injector import combine
from app.security.sql_guard import guard_readonly, to_sql
from app.security.sql_guard import referenced_tables


def validate(sql: str):
    root = guard_readonly(sql)
    for node in root.find_all(exp.Table):
        if node.name.lower() in SYSTEM_TABLES or node.catalog or (node.db and node.db != "public"):
            raise TableNotAllowedError([node.sql()])
    # 按作用域识别真实表，CTE 同名不能掩盖内部引用的越权表。
    for scope in traverse_scope(root):
        names = [name for name in scope.expression.named_selects if name and name != "*"]
        if len(names) != len(set(names)):
            raise SqlSyntaxError("输出字段名重复，请使用 AS 指定不同的字段名")
        for source in scope.sources.values():
            if isinstance(source, exp.Table) and not is_queryable(source.name):
                raise TableNotAllowedError([source.name])
    return root


def prepare(db, sql: str, user) -> str:
    root = validate(sql)
    tables = []
    for scope in traverse_scope(root):
        tables.extend(source for source in scope.sources.values() if isinstance(source, exp.Table))
    for table in tables:
        decision = decide(db, table.name, user)
        if not decision.conditions:
            continue
        source = table.copy()
        source.set("alias", None)
        # 每张源表先过滤，再 JOIN / 聚合 / UNION，避免只过滤最外层结果。
        filtered = exp.select("*").from_(source).where(combine(list(decision.conditions)))
        table.replace(filtered.subquery(alias=table.alias or table.name))
    return to_sql(root)


def mask_rows(db, sql: str, rows: list[dict]) -> list[dict]:
    from app.security.masking import MASK_FUNCS, mask_rules
    root = guard_readonly(sql)
    rules = {}
    for table in referenced_tables(root):
        for column, kind, pattern in mask_rules(db, table):
            rules.setdefault(column, []).append((kind, pattern))
    if not rules:
        return rows
    if any(alias.args.get("columns") for alias in root.find_all(exp.TableAlias)):
        raise SqlSyntaxError("包含脱敏字段的查询请使用 AS 逐列命名，不支持整组列重命名")
    # shortcut: 按列名保守传播脱敏，需区分同名源列时升级为字段血缘。
    aliases = list(root.find_all(exp.Alias))
    for _ in aliases:
        for alias in aliases:
            inherited = [rule for col in alias.this.find_all(exp.Column) for rule in rules.get(col.name, [])]
            if inherited and alias.alias not in rules:
                rules[alias.alias] = inherited
    for row in rows:
        for column, value in row.items():
            if value is None:
                continue
            for kind, pattern in rules.get(column, []):
                fn = MASK_FUNCS.get(kind)
                if fn:
                    value = fn(value, pattern) if kind == "custom" else fn(value)
            row[column] = value
    return rows


def preview(db, sql: str, user, limit: int = 500) -> dict:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise SqlSyntaxError("预览行数必须是 1 到 1000 的整数")
    started = time.perf_counter()
    prepared = prepare(db, sql, user)
    # 不修改原始 SQL；保存数据集时不带系统预览限制。
    limited = exp.select("*").from_(guard_readonly(prepared).subquery(alias="__preview")).limit(limit + 1)
    if db.get_bind().dialect.name == "postgresql":
        from app.query.executor import QUERY_TIMEOUT_MS
        db.execute(text(f"SET LOCAL statement_timeout = {QUERY_TIMEOUT_MS or 15000}"))
    result = db.execute(text(to_sql(limited)), {"uid": user.id})
    columns = list(result.keys())
    if len(columns) != len(set(columns)):
        raise SqlSyntaxError("输出字段名重复，请使用 AS 指定不同的字段名")
    # 使用数据库类型，空结果也能正确识别字段。
    types = {16: "bool", 20: "integer", 21: "integer", 23: "integer", 700: "numeric",
             701: "numeric", 1700: "numeric", 1082: "date", 1114: "datetime", 1184: "datetime"}
    description = getattr(getattr(result, "cursor", None), "description", None) or []
    column_types = [types.get(getattr(col, "type_code", None), "text") for col in description]
    fetched = result.fetchmany(limit + 1)
    rows = mask_rows(db, sql, [dict(row._mapping) for row in fetched[:limit]])
    return {"columns": columns, "rows": rows, "count": len(rows), "limit": limit,
            "truncated": len(fetched) > limit,
            "column_types": dict(zip(columns, column_types)),
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1)}

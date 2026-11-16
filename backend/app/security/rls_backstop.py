"""物理表 RLS 兜底（S6）—— 直连数据库也拦跨部门数据.

与 S3 的关系：
    * S3（ABAC）在 SQL 里 AND 部门条件，管的是「走应用的查询」；
    * 这里给**物理表**加 PostgreSQL 行级安全策略（RLS），管的是「绕过应用直连」；
    * 两者读同一份规则 `bi_dataset_scope_rule`，口径一致：department → 部门 id 集合，
      self → 列等于用户 id，all → 不隔离（管理员 / 高层）。

安全口径（fail-closed）：
    * 策略表达式缺少 `app.rls_enforced / app.dept_ids / app.user_id` 时一律不放行；
    * 数据集配了部门规则但物理表没有策略 → 预检先自愈，失败则 403（不是放行）；
    * 表不是物理表（视图 / 直连数据集）→ 不建策略，但失败会写审计告警。

连接变量（每次查询前由 `apply_session` 写入当前事务）：
    app.user_id / app.dept_id / app.dept_ids / app.data_scope / app.scope_mode / app.rls_enforced
"""

from __future__ import annotations

import os
import re
import time
from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.security.errors import RlsBlockedError

POLICY = "mcbi_dept_scope"
ROLE = "mcbi_rls"
CACHE_TTL_SECONDS = 30.0

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_checked: dict[str, float] = {}


def _q(name: str) -> str:
    if not _IDENT_RE.match(name or ""):
        raise ValueError(f"标识符不合法：{name}")
    return f'"{name}"'


def _split_table(physical_table: str) -> tuple[str, str]:
    parts = [part for part in str(physical_table or "").split(".") if part]
    if len(parts) == 2:
        return _q(parts[0]), _q(parts[1])
    if len(parts) == 1:
        return '"public"', _q(parts[0])
    raise ValueError(f"物理表名不合法：{physical_table}")


def _table_sql(physical_table: str) -> str:
    schema, table = _split_table(physical_table)
    return f"{schema}.{table}"


def _dataset(db: Session, dataset_id: int) -> Any:
    return db.execute(
        text("SELECT physical_table, conn_mode FROM bi_dataset WHERE id = :i"),
        {"i": int(dataset_id)},
    ).fetchone()


def _physical_column(db: Session, dataset_id: int, column_name: str) -> str | None:
    row = db.execute(
        text(
            "SELECT source_column FROM bi_dataset_field WHERE dataset_id = :d "
            "AND (name = :c OR source_column = :c) ORDER BY id LIMIT 1"
        ),
        {"d": int(dataset_id), "c": column_name},
    ).fetchone()
    return str(row[0]) if row and row[0] else None


def invalidate(dataset_id: int | None = None) -> None:
    if dataset_id is None:
        _checked.clear()
        return
    for key in [key for key in _checked if key.startswith(f"{int(dataset_id)}:")]:
        _checked.pop(key, None)


def _alert(db: Session, dataset_id: int, kind: str, message: str) -> None:
    """安全告警：日志 + 审计（不动业务库事务，写失败也不影响主流程）."""
    text_message = " ".join(str(message).split())[:300]
    print(f"[rls] dataset={dataset_id} {kind}: {text_message}")
    try:
        from app.middleware.audit import log_audit

        log_audit(None, f"security.rls.{kind}", "dataset", int(dataset_id),
                  {"message": text_message})
    except Exception:
        pass


def ensure_role(db: Session) -> bool:
    """确保只读角色存在（直连 / SET ROLE 用）；没有 CREATEROLE 权限时只告警."""
    try:
        exists = db.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}
        ).fetchone()
        if exists is None:
            db.execute(text(f"CREATE ROLE {ROLE} NOLOGIN"))
            db.commit()
        db.execute(text(f"GRANT USAGE ON SCHEMA public TO {ROLE}"))
        db.execute(text(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {ROLE}"))
        db.execute(text(
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {ROLE}"
        ))
        db.commit()
        return True
    except Exception as exc:
        db.rollback()
        print(f"[rls] 只读角色 {ROLE} 不可用（需要 CREATEROLE）：{str(exc)[:160]}")
        return False


def policy_expression(column: str, mode: str) -> str:
    """RLS USING 表达式：缺变量 → false；department 用 dept_ids，self 用 user_id."""
    col = _q(column)
    guard = "current_setting('app.rls_enforced', true) = '1'"
    bypass = "current_setting('app.data_scope', true) = 'all'"
    if mode == "self":
        mine = f"{col} = nullif(current_setting('app.user_id', true), '')::int"
        return f"({guard} AND ({bypass} OR {mine}))"
    allowed = (
        f"{col} = ANY (string_to_array("
        "nullif(current_setting('app.dept_ids', true), ''), ',')::int[])"
    )
    return f"({guard} AND ({bypass} OR {allowed}))"


def policy_status(db: Session, physical_table: str) -> bool:
    """表上是否已开启 RLS 且存在我们的策略（查系统表，不扫数据）."""
    try:
        schema, table = [part.strip('"') for part in _table_sql(physical_table).split(".")]
        row = db.execute(
            text(
                "SELECT c.relrowsecurity, c.relforcerowsecurity, "
                "  EXISTS (SELECT 1 FROM pg_policies p "
                "          WHERE p.schemaname = :s AND p.tablename = :t AND p.policyname = :p) "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = :s AND c.relname = :t AND c.relkind = 'r'"
            ),
            {"s": schema, "t": table, "p": POLICY},
        ).fetchone()
    except Exception:
        return False
    return bool(row and row[0] and row[2])


def _grant_select(db: Session, physical_table: str) -> None:
    try:
        if db.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}).fetchone():
            db.execute(text(f"GRANT SELECT ON {_table_sql(physical_table)} TO {ROLE}"))
    except Exception as exc:
        print(f"[rls] 授权 {ROLE} 读 {physical_table} 失败：{str(exc)[:120]}")


def sync_policy(db: Session, dataset_id: int) -> bool:
    """按数据集当前部门规则创建 / 刷新物理表策略；无规则或 all → 移除策略."""
    from app.security import dept_scope

    row = _dataset(db, int(dataset_id))
    if row is None or (row[1] or "extract") == "live" or not row[0]:
        return True
    table_sql = _table_sql(str(row[0]))

    rule = dept_scope.get_rule(db, int(dataset_id))
    if rule is None or rule["mode"] == "all":
        return drop_policy(db, int(dataset_id))

    column = _physical_column(db, int(dataset_id), rule["column_name"])
    if not column:
        _alert(db, int(dataset_id), "sync_failed", f"部门列不存在：{rule['column_name']}")
        return False
    try:
        expr = policy_expression(column, rule["mode"])
        db.execute(text(f"ALTER TABLE {table_sql} ENABLE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE {table_sql} FORCE ROW LEVEL SECURITY"))
        db.execute(text(f"DROP POLICY IF EXISTS {POLICY} ON {table_sql}"))
        db.execute(text(f"CREATE POLICY {POLICY} ON {table_sql} FOR SELECT USING ({expr})"))
        _grant_select(db, str(row[0]))
        db.commit()
        invalidate(int(dataset_id))
        return True
    except Exception as exc:
        db.rollback()
        _alert(db, int(dataset_id), "sync_failed", f"物理表策略创建失败：{str(exc)[:200]}")
        return False


def drop_policy(db: Session, dataset_id: int) -> bool:
    """移除策略；同一张表还有别的部门规则时改为按那条规则重建，避免误关隔离."""
    from app.security import dept_scope

    row = _dataset(db, int(dataset_id))
    if row is None or (row[1] or "extract") == "live" or not row[0]:
        return True
    table_sql = _table_sql(str(row[0]))

    sibling = db.execute(
        text(
            "SELECT r.dataset_id FROM bi_dataset_scope_rule r "
            "JOIN bi_dataset d ON d.id = r.dataset_id "
            "WHERE d.physical_table = :t AND r.mode <> 'all' AND r.dataset_id <> :i "
            "ORDER BY r.dataset_id LIMIT 1"
        ),
        {"t": str(row[0]), "i": int(dataset_id)},
    ).fetchone()
    if sibling is not None:
        return sync_policy(db, int(sibling[0]))

    try:
        db.execute(text(f"DROP POLICY IF EXISTS {POLICY} ON {table_sql}"))
        db.execute(text(f"ALTER TABLE {table_sql} NO FORCE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE {table_sql} DISABLE ROW LEVEL SECURITY"))
        db.commit()
        invalidate(int(dataset_id))
        return True
    except Exception as exc:
        db.rollback()
        _alert(db, int(dataset_id), "drop_failed", f"物理表策略移除失败：{str(exc)[:200]}")
        return False


def preflight(db: Session, dataset_id: int | None) -> None:
    """查询前预检：策略缺失先自愈，仍然失败 → 403（fail-closed）."""
    if not dataset_id:
        return
    from app.security import dept_scope

    rule = dept_scope.get_rule(db, int(dataset_id))
    if rule is None or rule["mode"] == "all":
        return
    row = _dataset(db, int(dataset_id))
    if row is None or (row[1] or "extract") == "live" or not row[0]:
        return

    key = f"{int(dataset_id)}:{rule['column_name']}:{rule['mode']}"
    now = time.monotonic()
    cached = _checked.get(key)
    if cached and now - cached < CACHE_TTL_SECONDS:
        return

    if not policy_status(db, str(row[0])):
        if not sync_policy(db, int(dataset_id)) or not policy_status(db, str(row[0])):
            _alert(db, int(dataset_id), "policy_missing",
                   f"物理表 {row[0]} 缺少 RLS 策略，已拒绝放行")
            raise RlsBlockedError(
                "部门隔离的物理表策略缺失，已拒绝放行",
                detail=f"dataset={dataset_id} table={row[0]}",
            )
    _checked[key] = now


def apply_session(db: Session, user: Any, dataset_id: int | None = None) -> None:
    """把当前用户的部门范围写进事务变量（RLS 策略读这些变量）."""
    from app.admin.permissions import data_scope, department_subtree_ids

    scope = "self"
    if user is not None:
        try:
            scope = data_scope(db, user)
        except Exception:
            scope = "self"

    dept_ids = ""
    department_id = int(getattr(user, "department_id", 0) or 0) if user is not None else 0
    if department_id and scope != "all":
        if scope == "dept_and_children":
            dept_ids = ",".join(str(int(i)) for i in department_subtree_ids(db, department_id))
        else:
            dept_ids = str(department_id)

    mode = ""
    if dataset_id:
        from app.security import dept_scope

        rule = dept_scope.get_rule(db, int(dataset_id))
        mode = (rule or {}).get("mode") or ""

    values = {
        "app.user_id": str(int(getattr(user, "id", 0) or 0)),
        "app.dept_id": str(department_id),
        "app.dept_ids": dept_ids,
        "app.data_scope": scope,
        "app.scope_mode": mode,
        "app.rls_enforced": "1",
    }
    for key, value in values.items():
        db.execute(text("SELECT set_config(:k, :v, true)"), {"k": key, "v": value})


@contextmanager
def read_role(db: Session) -> Iterator[None]:
    """可选：数据查询期间切到只读角色（`BI_RLS_APP_ROLE`），让应用连接也受 RLS 约束."""
    role = (os.getenv("BI_RLS_APP_ROLE") or "").strip()
    if not role:
        yield
        return
    try:
        db.execute(text(f"SET LOCAL ROLE {_q(role)}"))
    except Exception as exc:
        raise RlsBlockedError(
            f"RLS 只读角色不可用：{role}", detail=str(exc)[:160]
        ) from exc
    try:
        yield
    finally:
        try:
            db.execute(text("RESET ROLE"))
        except Exception:
            pass


def ensure_all(db: Session) -> dict:
    """启动自检：确保只读角色 + 给所有已配置的规则补策略."""
    role_ok = ensure_role(db)
    rows = db.execute(
        text("SELECT dataset_id FROM bi_dataset_scope_rule WHERE mode <> 'all'")
    ).fetchall()
    synced = sum(1 for row in rows if sync_policy(db, int(row[0])))
    invalidate()
    return {"role": role_ok, "total": len(rows), "synced": synced}


__all__ = [
    "POLICY", "ROLE", "apply_session", "drop_policy", "ensure_all", "ensure_role",
    "invalidate", "policy_expression", "policy_status", "preflight", "read_role", "sync_policy",
]

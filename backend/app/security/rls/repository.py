"""行级权限规则读取（只读，不写）.

语义与既有 GET /row_permissions/{table} 完全一致：
    user_id = 当前用户  OR  role_name = 当前用户角色
这样历史数据与旧接口不会出现「两套口径」。
"""

from __future__ import annotations

from typing import Any, Iterator

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.security.rls.models import RowRule


def iter_rules(db: Session, table: str, user: Any) -> Iterator[RowRule]:
    """按表加载当前用户生效的规则."""
    if user is None or not getattr(user, "id", None):
        return iter(())  # 系统上下文不套行级规则

    role = getattr(user, "role", None) or ""
    rows = db.execute(
        text(
            """
            SELECT table_name, user_id, role_name, filter_rule
              FROM bi_row_permissions
             WHERE table_name = :t
               AND (user_id = :uid OR role_name = :role)
             ORDER BY id
            """
        ),
        {"t": table, "uid": user.id, "role": role},
    ).fetchall()

    rules = [
        RowRule(
            table_name=r[0],
            user_id=r[1],
            role_name=r[2],
            filter_rule=(r[3] or "").strip(),
        )
        for r in rows
    ]
    return iter([r for r in rules if r.filter_rule])


def load_rules(db: Session, table: str, user: Any) -> list[RowRule]:
    return list(iter_rules(db, table, user))


__all__ = ["iter_rules", "load_rules"]

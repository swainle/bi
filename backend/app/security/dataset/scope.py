"""数据集部门隔离（S3）—— ABAC 的「部门维度」补齐.

数据模型：`bi_dataset_scope_rule`（迁移 047），一个数据集最多一条规则：
    dataset_id / column_name（部门列）/ mode（department | self | all）

生效方式：查询执行器在**现有行级规则旁**再 AND 一个条件（见 `dataset_rules.row_conditions`），
因此 UI、MCP、看板渲染、告警、定时报表走的是同一条链路，不会出现两套口径。

安全口径（fail-closed）：
    * 规则存在但列不存在 / 账号没有部门 / 模式非法 → `RlsBlockedError`（403），绝不放全量；
    * 没有规则 = 行为不变（是否隔离由数据集负责人显式配置）；
    * 数据范围 `all` 的角色（管理员 / 高层）不注入，但列脱敏照旧；
    * 条件里的部门 id 一律转成整数后拼接，不接收外部字符串。
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.permissions import data_scope, department_subtree_ids, is_admin
from app.query.builder import quote
from app.security.errors import RlsBlockedError

MODES = ("department", "self", "all")
MODE_LABELS = {"department": "按部门", "self": "只看自己", "all": "不隔离"}

# 允许的列名形态（列必须先在 bi_dataset_field 里存在，这里再兜一层，防止拼串注入）
_IDENT_RE = re.compile(r"^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*$")


class DeptScopeError(ValueError):
    """配置不合法（给前端 400 看的中文提示）."""


def _row(row) -> dict | None:
    if row is None:
        return None
    return {
        "dataset_id": int(row[0]),
        "column_name": row[1],
        "mode": row[2],
        "created_by": row[3],
        "created_at": str(row[4] or ""),
    }


def get_rule(db: Session, dataset_id: int) -> dict | None:
    row = db.execute(
        text(
            "SELECT dataset_id, column_name, mode, created_by, created_at "
            "FROM bi_dataset_scope_rule WHERE dataset_id = :d"
        ),
        {"d": int(dataset_id)},
    ).fetchone()
    return _row(row)


def set_rule(db: Session, dataset_id: int, *, column_name: str, mode: str,
             created_by: int | None = None) -> dict:
    column = (column_name or "").strip()
    if mode not in MODES:
        raise DeptScopeError(f"不支持的隔离模式：{mode}")
    if not column:
        raise DeptScopeError("请选择部门列")
    if not _IDENT_RE.match(column):
        raise DeptScopeError(f"列名不合法：{column}")

    exists = db.execute(
        text(
            "SELECT 1 FROM bi_dataset_field WHERE dataset_id = :d "
            "AND (name = :c OR source_column = :c) LIMIT 1"
        ),
        {"d": int(dataset_id), "c": column},
    ).fetchone()
    if exists is None:
        raise DeptScopeError(f"数据集里没有这个字段：{column}")

    db.execute(
        text(
            "INSERT INTO bi_dataset_scope_rule (dataset_id, column_name, mode, created_by) "
            "VALUES (:d, :c, :m, :by) "
            "ON CONFLICT (dataset_id) DO UPDATE SET column_name = :c, mode = :m, "
            "  created_by = :by, created_at = now()"
        ),
        {"d": int(dataset_id), "c": column, "m": mode, "by": created_by},
    )
    db.commit()

    # S6：规则一变就把物理表策略同步过去；建不出来就回滚规则，绝不留「配了隔离但没生效」
    from app.security import rls_backstop

    if not rls_backstop.sync_policy(db, int(dataset_id)):
        db.execute(text("DELETE FROM bi_dataset_scope_rule WHERE dataset_id = :d"),
                   {"d": int(dataset_id)})
        db.commit()
        raise DeptScopeError("物理表 RLS 策略创建失败，已回滚（详见安全审计）")
    return get_rule(db, dataset_id) or {}


def delete_rule(db: Session, dataset_id: int) -> dict:
    result = db.execute(
        text("DELETE FROM bi_dataset_scope_rule WHERE dataset_id = :d"), {"d": int(dataset_id)}
    )
    db.commit()

    from app.security import rls_backstop

    rls_backstop.drop_policy(db, int(dataset_id))
    return {"dataset_id": int(dataset_id), "deleted": result.rowcount > 0}


def condition_for(db: Session, dataset_id: int | None, user: Any,
                  dialect: str = "postgres") -> str | None:
    """当前用户在这个数据集上的部门条件；None = 不注入."""
    if not dataset_id or user is None:
        return None
    if is_admin(user):
        return None
    scope = data_scope(db, user)
    if scope == "all":
        return None

    rule = get_rule(db, int(dataset_id))
    if rule is None or rule["mode"] == "all":
        return None

    column = rule["column_name"]
    # 配置里存的是「字段名」，注入 SQL 要用「物理列名」（两者常不同，如 部门 → dept_id）
    field = db.execute(
        text(
            "SELECT source_column FROM bi_dataset_field WHERE dataset_id = :d "
            "AND (name = :c OR source_column = :c) ORDER BY id LIMIT 1"
        ),
        {"d": int(dataset_id), "c": column},
    ).fetchone()
    if field is None or not field[0]:
        raise RlsBlockedError(
            f"部门隔离配置失效：字段 «{column}» 不在数据集里",
            detail=f"dataset={dataset_id}",
        )
    physical = str(field[0])
    if not _IDENT_RE.match(physical):
        raise RlsBlockedError(
            f"部门隔离配置失效：物理列名不合法 «{physical}»", detail=f"dataset={dataset_id}"
        )

    quoted = quote(physical, dialect)

    if rule["mode"] == "self":
        user_id = getattr(user, "id", None)
        if not user_id:
            raise RlsBlockedError("无法确定当前用户，部门隔离拒绝放行")
        return f"{quoted} = {int(user_id)}"

    department_id = getattr(user, "department_id", None)
    if not department_id:
        raise RlsBlockedError(
            "账号未分配部门，无法按部门隔离", detail=f"user={getattr(user, 'id', None)}"
        )
    if scope == "dept_and_children":
        ids = department_subtree_ids(db, int(department_id))
    else:
        ids = [int(department_id)]
    if not ids:
        raise RlsBlockedError("部门范围为空，部门隔离拒绝放行")
    joined = ", ".join(str(int(i)) for i in ids)
    return f"{quoted} IN ({joined})"


__all__ = ["MODE_LABELS", "MODES", "DeptScopeError", "condition_for", "delete_rule", "get_rule", "set_rule"]

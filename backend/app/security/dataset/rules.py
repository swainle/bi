"""数据集级行列权限（P4）.

与既有表级规则的关系：
    * 行级：`bi_row_permissions`（按物理表）与 `bi_dataset_row_rule`（按数据集）**同时 AND**；
    * 列级：先套 `bi_column_masks`（按物理表），再套 `bi_dataset_column_mask`（按数据集，同列以数据集为准）。

为什么按 dataset_id 配：模板复制会把数据搬到 `bi_tpl_*` 新表，表名一变规则就丢了；
按数据集存，复制数据集时整组规则跟着走（见 `template_market._copy_dataset`）。

安全口径：
    * 规则编译失败 → `RlsBlockedError`（fail-closed，宁可 403 不放大数据）；
    * 没有规则 → 零开销，不改 SQL、不改结果。
"""

from __future__ import annotations

from app.timezone import time_text

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.security.errors import RlsBlockedError
from app.security.dataset.masking import MASK_FUNCS
from app.security.rls.compiler import compile_condition

MASK_TYPES = ("phone", "id_card", "email", "custom")


class DatasetRuleError(ValueError):
    """数据集权限配置不合法（给前端 400 看的中文提示）."""


def list_rules(db: Session, dataset_id: int) -> dict:
    """列出一个数据集的行级规则与列级脱敏."""
    row_rows = db.execute(
        text(
            "SELECT r.id, r.user_id, u.username, r.role_name, r.filter_rule, r.note, r.created_at "
            "FROM bi_dataset_row_rule r LEFT JOIN users u ON u.id = r.user_id "
            "WHERE r.dataset_id = :d ORDER BY r.id"
        ),
        {"d": dataset_id},
    ).fetchall()
    mask_rows = db.execute(
        text(
            "SELECT id, column_name, mask_type, mask_pattern, created_at "
            "FROM bi_dataset_column_mask WHERE dataset_id = :d ORDER BY id"
        ),
        {"d": dataset_id},
    ).fetchall()
    return {
        "row_rules": [
            {
                "id": r[0], "user_id": r[1], "username": r[2] or "",
                "role_name": r[3] or "", "filter_rule": r[4], "note": r[5] or "",
                "created_at": time_text(r[6] or ""),
            }
            for r in row_rows
        ],
        "masks": [
            {
                "id": r[0], "column_name": r[1], "mask_type": r[2],
                "mask_pattern": r[3] or "", "created_at": time_text(r[4] or ""),
            }
            for r in mask_rows
        ],
        "dept_scope": _dept_scope_payload(db, int(dataset_id)),
    }


def _dept_scope_payload(db: Session, dataset_id: int) -> dict | None:
    from app.security import dept_scope

    return dept_scope.get_rule(db, dataset_id)


def add_row_rule(
    db: Session,
    dataset_id: int,
    *,
    filter_rule: str,
    user_id: int | None = None,
    role_name: str | None = None,
    note: str = "",
    created_by: int | None = None,
) -> dict:
    """新增一条行级规则（同一 dataset + 用户/角色 只保留一条，重复则覆盖）."""
    condition = (filter_rule or "").strip()
    if not condition:
        raise DatasetRuleError("行级条件不能为空")
    try:
        compile_condition(condition)  # 编译不过的规则不允许入库
    except Exception as exc:  # RuleCompileError / 其它方言问题
        raise DatasetRuleError(f"行级条件不合法：{getattr(exc, 'message', str(exc))}") from exc

    if user_id:
        db.execute(
            text(
                "DELETE FROM bi_dataset_row_rule "
                "WHERE dataset_id = :d AND user_id = :u"
            ),
            {"d": dataset_id, "u": int(user_id)},
        )
    elif role_name:
        db.execute(
            text(
                "DELETE FROM bi_dataset_row_rule "
                "WHERE dataset_id = :d AND user_id IS NULL AND role_name = :r"
            ),
            {"d": dataset_id, "r": role_name},
        )
    else:
        db.execute(
            text(
                "DELETE FROM bi_dataset_row_rule "
                "WHERE dataset_id = :d AND user_id IS NULL AND role_name IS NULL"
            ),
            {"d": dataset_id},
        )

    row = db.execute(
        text(
            "INSERT INTO bi_dataset_row_rule "
            "  (dataset_id, user_id, role_name, filter_rule, note, created_by) "
            "VALUES (:d, :u, :r, :f, :n, :by) RETURNING id"
        ),
        {
            "d": dataset_id, "u": int(user_id) if user_id else None,
            "r": role_name or None, "f": condition,
            "n": (note or "")[:200], "by": created_by,
        },
    ).fetchone()
    db.commit()
    return {"id": int(row[0]), "dataset_id": dataset_id}


def delete_row_rule(db: Session, dataset_id: int, rule_id: int) -> dict:
    result = db.execute(
        text("DELETE FROM bi_dataset_row_rule WHERE id = :id AND dataset_id = :d"),
        {"id": rule_id, "d": dataset_id},
    )
    db.commit()
    return {"deleted": result.rowcount > 0, "id": rule_id}


def set_mask(
    db: Session,
    dataset_id: int,
    *,
    column_name: str,
    mask_type: str,
    mask_pattern: str = "",
    created_by: int | None = None,
) -> dict:
    """新增 / 更新一列脱敏（同一数据集同一列只有一条）."""
    column = (column_name or "").strip()
    if not column:
        raise DatasetRuleError("请选择要脱敏的字段")
    if mask_type not in MASK_TYPES:
        raise DatasetRuleError(f"不支持的脱敏类型：{mask_type}")
    if mask_type == "custom" and "{val}" not in (mask_pattern or ""):
        raise DatasetRuleError("自定义模板必须包含 {val}")

    db.execute(
        text(
            "INSERT INTO bi_dataset_column_mask "
            "  (dataset_id, column_name, mask_type, mask_pattern, created_by) "
            "VALUES (:d, :c, :t, :p, :by) "
            "ON CONFLICT (dataset_id, column_name) DO UPDATE SET "
            "  mask_type = :t, mask_pattern = :p"
        ),
        {
            "d": dataset_id, "c": column, "t": mask_type,
            "p": (mask_pattern or "")[:200], "by": created_by,
        },
    )
    db.commit()
    return {"dataset_id": dataset_id, "column_name": column, "mask_type": mask_type}


def delete_mask(db: Session, dataset_id: int, column_name: str) -> dict:
    result = db.execute(
        text("DELETE FROM bi_dataset_column_mask WHERE dataset_id = :d AND column_name = :c"),
        {"d": dataset_id, "c": column_name},
    )
    db.commit()
    return {"deleted": result.rowcount > 0, "column_name": column_name}


def _rows(db: Session, dataset_id: int, user: Any) -> list[Any]:
    user_id = getattr(user, "id", None)
    role = getattr(user, "role", "") or ""
    if not user_id:
        return []
    return db.execute(
        text(
            "SELECT filter_rule FROM bi_dataset_row_rule "
            "WHERE dataset_id = :d AND ("
            "  user_id = :u OR (user_id IS NULL AND :role <> '' AND role_name = :role)"
            "  OR (user_id IS NULL AND role_name IS NULL)"
            ") ORDER BY id"
        ),
        {"d": dataset_id, "u": user_id, "role": role},
    ).fetchall()


def row_conditions(db: Session, dataset_id: int | None, user: Any,
                   dialect: str = "postgres") -> list[str]:
    """该数据集对当前用户生效的行级条件（编译失败 → fail-closed）.

    顺序：手配行级规则 → 部门隔离（S3，`bi_dataset_scope_rule`）；两者同时 AND。
    部门隔离在 `dept_scope.condition_for` 内自行判断「无规则 / 数据范围 all → 不注入」。
    """
    if not dataset_id:
        return []
    conditions: list[str] = []
    for row in _rows(db, int(dataset_id), user):
        rule = (row[0] or "").strip()
        if not rule:
            continue
        try:
            compile_condition(rule)
        except Exception as exc:
            raise RlsBlockedError(
                f"数据集行级规则无效：{getattr(exc, 'message', str(exc))}",
                detail=f"dataset={dataset_id}",
            ) from exc
        conditions.append(rule)

    from app.security import dept_scope

    dept_condition = dept_scope.condition_for(db, int(dataset_id), user, dialect)
    if dept_condition:
        conditions.append(dept_condition)
    return conditions


def apply_dataset_masks(db: Session, dataset_id: int | None, rows: list[dict]) -> list[dict]:
    """套数据集的列级脱敏；结果列的键既可能是语义名，也可能是物理列名，两种都盖."""
    if not dataset_id or not rows:
        return rows
    rules = db.execute(
        text(
            "SELECT column_name, mask_type, mask_pattern "
            "FROM bi_dataset_column_mask WHERE dataset_id = :d ORDER BY id"
        ),
        {"d": int(dataset_id)},
    ).fetchall()
    if not rules:
        return rows

    field_rows = db.execute(
        text("SELECT name, source_column FROM bi_dataset_field WHERE dataset_id = :d"),
        {"d": int(dataset_id)},
    ).fetchall()
    source_of = {str(r[0]): str(r[1]) for r in field_rows}

    for column, mtype, pattern in rules:
        fn = MASK_FUNCS.get(mtype)
        if not fn:
            continue
        keys = {str(column)}
        if source_of.get(str(column)):
            keys.add(source_of[str(column)])
        for row in rows:
            for key in keys:
                if key in row and row[key] is not None:
                    row[key] = fn(row[key]) if mtype != "custom" else fn(row[key], pattern)
    return rows


__all__ = [
    "DatasetRuleError", "MASK_TYPES",
    "list_rules", "add_row_rule", "delete_row_rule", "set_mask", "delete_mask",
    "row_conditions", "apply_dataset_masks",
]

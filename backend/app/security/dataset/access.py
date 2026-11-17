"""数据集的部门归属与可见性（2026-11-14）.

口径（与数据集列表完全一致，避免「列表看不到但能按 id 取数」）：
    * `owner_id IS NULL` → 公共数据集，所有人可见（种子 / 模板副本 / 公共测试数据）；
    * `owner_id = 当前用户` → 自己的数据集；
    * `dept_id` 有值且落在用户数据范围内（含下级）→ 部门资产，本部门可见；
    * 其余 → 不可见（403）。

「归属部门」只决定可见性/取数准入；行级过滤仍由 `bi_dataset_scope_rule`（S3）负责，两者互不替代。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.permissions import is_admin, scoped_department_ids


def department_of(db: Session, dept_id: int | None) -> dict | None:
    """部门 id → {id, name}（部门不存在返回 None）."""
    if not dept_id:
        return None
    row = db.execute(
        text("SELECT id, name FROM departments WHERE id = :i AND COALESCE(is_deleted, false) = false"),
        {"i": int(dept_id)},
    ).fetchone()
    return {"id": int(row[0]), "name": row[1]} if row else None


def can_access_dataset(db: Session, dataset: Any, user: Any) -> bool:
    if user is None or dataset is None:
        return False
    if is_admin(user):
        return True
    owner_id = getattr(dataset, "owner_id", None)
    if owner_id is None or owner_id == getattr(user, "id", None):
        return True
    dept_id = getattr(dataset, "dept_id", None)
    if not dept_id:
        return False
    scoped = scoped_department_ids(db, user)
    if scoped is None:
        return True
    return int(dept_id) in scoped


def assert_dataset_visible(db: Session, dataset: Any, user: Any) -> None:
    """不可见 → 403（与其他权限拒绝同一口径）."""
    if can_access_dataset(db, dataset, user):
        return
    from fastapi import HTTPException

    raise HTTPException(403, "没有该数据集的权限（不属于你的部门）")


def validate_dept_choice(db: Session, dept_id: Any, user: Any) -> int | None:
    """新建 / 修改时选择归属部门：空 = 全局；不能选自己数据范围之外的部门."""
    if dept_id in (None, "", 0, "0"):
        return None
    try:
        value = int(dept_id)
    except (TypeError, ValueError) as exc:
        from fastapi import HTTPException

        raise HTTPException(400, "部门不合法") from exc
    if department_of(db, value) is None:
        from fastapi import HTTPException

        raise HTTPException(400, "部门不存在")
    scoped = scoped_department_ids(db, user)
    if scoped is not None and value not in scoped:
        from fastapi import HTTPException

        raise HTTPException(403, "只能把数据归到自己有权限的部门")
    return value


__all__ = [
    "assert_dataset_visible", "can_access_dataset", "department_of", "validate_dept_choice",
]

"""管理后台 · 部门树（/departments）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import data_scope, require
from app.database import get_db
from app.middleware.audit import log_audit
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

from .common import DepartmentCreateBody, DepartmentPatchBody, _department_user_count, _list_departments, _normalize_dept_name, _require_department, _scope_dept_ids, require_global_admin

@router.get("/departments")
def list_departments(
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    items = _list_departments(db)
    scope_ids = _scope_dept_ids(db, current_user)
    if scope_ids is not None:
        allowed = set(scope_ids) if scope_ids else {int(current_user.department_id or 0)}
        items = [d for d in items if d["id"] in allowed]
    return {"items": items, "data_scope": data_scope(db, current_user)}


@router.post("/departments")
def create_department(
    payload: DepartmentCreateBody,
    current_user: User = Depends(require_global_admin),
    db: Session = Depends(get_db),
):
    name = _normalize_dept_name(payload.name)
    dup = db.execute(
        text(
            "SELECT 1 FROM departments WHERE COALESCE(is_deleted, false) = false "
            "AND lower(name) = lower(:name)"
        ),
        {"name": name},
    ).first()
    if dup:
        raise HTTPException(409, f"部门「{name}」已存在")
    parent_id = payload.parent_id
    if parent_id is not None:
        _require_department(db, parent_id)
    row = db.execute(
        text(
            "INSERT INTO departments (name, sort_order, is_deleted, parent_id, created_at) "
            "SELECT :name, COALESCE(MAX(sort_order), 0) + 10, false, :parent_id, now() "
            "FROM departments WHERE COALESCE(is_deleted, false) = false "
            "RETURNING id"
        ),
        {"name": name, "parent_id": parent_id},
    ).fetchone()
    db.commit()
    log_audit(current_user.id, "admin.department.create", "department", int(row[0]), {"name": name})
    return {"id": int(row[0]), "message": "部门已添加"}


@router.patch("/departments/{dept_id}")
def update_department(
    dept_id: int,
    payload: DepartmentPatchBody,
    current_user: User = Depends(require_global_admin),
    db: Session = Depends(get_db),
):
    _require_department(db, dept_id)
    data = payload.model_dump(exclude_unset=True)
    sets: list[str] = []
    params: dict = {"id": dept_id}

    if "parent_id" in data:
        parent_id = data["parent_id"]
        if parent_id is not None:
            _require_department(db, parent_id)
            if int(parent_id) == int(dept_id):
                raise HTTPException(400, "上级部门不能是自己")
            from app.admin.permissions import department_subtree_ids

            if int(parent_id) in department_subtree_ids(db, dept_id):
                raise HTTPException(400, "不能把部门移到自己的下级里")
        sets.append("parent_id = :parent_id")
        params["parent_id"] = parent_id

    if data.get("name"):
        name = _normalize_dept_name(data["name"])
        dup = db.execute(
            text(
                "SELECT 1 FROM departments WHERE COALESCE(is_deleted, false) = false "
                "AND lower(name) = lower(:name) AND id <> :id"
            ),
            {"name": name, "id": dept_id},
        ).first()
        if dup:
            raise HTTPException(409, f"部门「{name}」已存在")
        sets.append("name = :name")
        params["name"] = name
    if data.get("sort_order") is not None:
        sets.append("sort_order = :sort_order")
        params["sort_order"] = int(data["sort_order"])
    if "leader_id" in data:
        leader = data["leader_id"]
        if leader is None:
            sets.append("leader_id = NULL")
        else:
            row = db.execute(
                text(
                    "SELECT 1 FROM users WHERE id = :id AND is_active "
                    "AND COALESCE(approval_status, 'approved') = 'approved'"
                ),
                {"id": int(leader)},
            ).first()
            if not row:
                raise HTTPException(400, "负责人必须是启用且已通过审批的账号")
            sets.append("leader_id = :leader_id")
            params["leader_id"] = int(leader)

    if not sets:
        return {"message": "没有需要保存的修改"}
    db.execute(text(f"UPDATE departments SET {', '.join(sets)} WHERE id = :id"), params)
    db.commit()
    log_audit(current_user.id, "admin.department.update", "department", dept_id, data)
    return {"message": "已保存"}


@router.delete("/departments/{dept_id}")
def delete_department(
    dept_id: int,
    current_user: User = Depends(require_global_admin),
    db: Session = Depends(get_db),
):
    row = _require_department(db, dept_id)
    used = _department_user_count(db, dept_id)
    if used > 0:
        raise HTTPException(400, f"还有 {used} 个用户在该部门，先调整他们的部门再删")
    children = int(
        db.execute(
            text(
                "SELECT count(*) FROM departments WHERE parent_id = :id "
                "AND COALESCE(is_deleted, false) = false"
            ),
            {"id": dept_id},
        ).scalar()
        or 0
    )
    if children > 0:
        raise HTTPException(400, f"该部门还有 {children} 个下级部门，先移走再删")
    db.execute(text("UPDATE departments SET is_deleted = true WHERE id = :id"), {"id": dept_id})
    db.commit()
    log_audit(current_user.id, "admin.department.delete", "department", dept_id, {"name": row[1]})
    return {"message": "部门已删除"}

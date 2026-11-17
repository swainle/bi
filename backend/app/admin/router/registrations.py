"""管理后台 · 注册审批（/registrations）。"""

from __future__ import annotations

from datetime import datetime
from fastapi import Body, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.audit import log_audit
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

from .common import RejectBody, _drop_user_cache, _load_pending_target, _registration_scope, require_approver

@router.get("/registrations")
def list_registrations(
    status: str = Query("pending", max_length=20),
    limit: int = Query(100, ge=1, le=300),
    current_user: User = Depends(require_approver),
    db: Session = Depends(get_db),
):
    state = (status or "pending").strip()
    if state not in ("pending", "approved", "rejected"):
        raise HTTPException(400, "状态只能是 pending / approved / rejected")

    scope = _registration_scope(db, current_user)
    scope_sql = ""
    scope_params: dict = {}
    if scope is not None:
        placeholders = ", ".join(f":d{i}" for i in range(len(scope)))
        scope_sql = f" AND u.department_id IN ({placeholders})"
        scope_params = {f"d{i}": dept_id for i, dept_id in enumerate(scope)}

    rows = db.execute(
        text(
            "SELECT u.id, u.username, u.email, u.role, u.department_id, d.name, u.created_at, "
            "       COALESCE(u.approval_status, 'approved'), u.reject_reason, u.approved_at "
            "FROM users u LEFT JOIN departments d ON d.id = u.department_id "
            "WHERE COALESCE(u.approval_status, 'approved') = :state"
            f"{scope_sql} "
            "ORDER BY u.created_at DESC, u.id DESC LIMIT :limit"
        ),
        {"state": state, "limit": limit, **scope_params},
    ).fetchall()

    pending_total = int(
        db.execute(
            text(
                "SELECT count(*) FROM users u "
                "WHERE COALESCE(u.approval_status, 'approved') = 'pending'"
                f"{scope_sql}"
            ),
            scope_params,
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "id": int(r[0]),
                "username": r[1],
                "email": r[2],
                "role": r[3] or "user",
                "department_id": r[4],
                "department_name": r[5] or "未分配",
                "created_at": str(r[6] or ""),
                "approval_status": r[7] or "approved",
                "reject_reason": r[8] or "",
                "approved_at": str(r[9] or ""),
            }
            for r in rows
        ],
        "pending": pending_total,
        "scope": "all" if scope is None else "department",
    }


@router.post("/registrations/{user_id}/approve")
def approve_registration(
    user_id: int,
    current_user: User = Depends(require_approver),
    db: Session = Depends(get_db),
):
    target = _load_pending_target(db, user_id, current_user, allow_rejected=True)
    target.approval_status = "approved"
    target.is_active = True
    target.approved_by = current_user.id
    target.approved_at = datetime.utcnow()
    target.reject_reason = None
    target.token_version = (target.token_version or 0) + 1
    db.commit()
    _drop_user_cache(target.id)
    log_audit(
        current_user.id, "admin.registration.approve", "user", target.id,
        {"username": target.username, "department_id": target.department_id},
    )
    return {"message": f"已通过「{target.username}」的注册申请"}


@router.post("/registrations/{user_id}/reject")
def reject_registration(
    user_id: int,
    payload: RejectBody = Body(default=RejectBody()),
    current_user: User = Depends(require_approver),
    db: Session = Depends(get_db),
):
    target = _load_pending_target(db, user_id, current_user)
    reason = (payload.reason or "").strip()[:200]
    target.approval_status = "rejected"
    target.is_active = False
    target.approved_by = current_user.id
    target.approved_at = datetime.utcnow()
    target.reject_reason = reason or None
    target.token_version = (target.token_version or 0) + 1
    db.commit()
    _drop_user_cache(target.id)
    log_audit(
        current_user.id, "admin.registration.reject", "user", target.id,
        {"username": target.username, "department_id": target.department_id, "reason": reason},
    )
    return {"message": f"已驳回「{target.username}」的注册申请"}

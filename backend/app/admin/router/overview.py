"""管理后台 · 概览与元信息（/overview、/meta）。"""

from __future__ import annotations

import time
from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import data_scope, has_permission, require
from app.database import get_db
from app.errors import repository as errors_repo
from app.models.rbac import Role
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

from .common import _actor_department, _list_departments, _redis_state, _scope, _scope_dept_ids

@router.get("/overview")
def overview(
    current_user: User = Depends(require("bi:overview")),
    db: Session = Depends(get_db),
):
    def scalar(sql: str, params: dict | None = None) -> int:
        try:
            return int(db.execute(text(sql), params or {}).scalar() or 0)
        except Exception:
            return 0

    scope = _scope(db, current_user)
    scope_ids = _scope_dept_ids(db, current_user)
    can_view_errors = has_permission(db, current_user, "bi:error:view")
    if scope_ids is None:
        users_filter, users_params = "", {}
    elif scope_ids:
        placeholders = ", ".join(f":d{i}" for i in range(len(scope_ids)))
        users_filter = f" AND department_id IN ({placeholders})"
        users_params = {f"d{i}": d for i, d in enumerate(scope_ids)}
    else:
        users_filter, users_params = " AND id = :self_id", {"self_id": current_user.id}

    from app.database import get_pool_status

    try:
        from app.routers.metrics import collect as metrics_collect

        app_info = metrics_collect().get("app", {})
    except Exception:
        app_info = {}

    started = time.monotonic()
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    latency_ms = round((time.monotonic() - started) * 1000, 1)

    recent = []
    if can_view_errors:
        try:
            recent = errors_repo.list_errors(db, limit=4)
        except Exception:
            recent = []

    return {
        "scope": scope,
        "data_scope": data_scope(db, current_user),
        "counts": {
            "users": scalar(
                f"SELECT count(*) FROM users WHERE 1=1{users_filter}", users_params
            ),
            "active_users": scalar(
                f"SELECT count(*) FROM users WHERE is_active{users_filter}", users_params
            ),
            "dashboards": scalar("SELECT count(*) FROM bi_canvas"),
            "datasets": scalar("SELECT count(*) FROM bi_dataset"),
            "sources": scalar("SELECT count(*) FROM bi_source"),
            # 没有错误日志权限的账号，概览里也不给错误数
            "error_24h": scalar(
                "SELECT count(*) FROM bi_error_log WHERE created_at >= now() - interval '24 hours'"
            ) if can_view_errors else 0,
            "pending_registrations": scalar(
                "SELECT count(*) FROM users "
                "WHERE COALESCE(approval_status, 'approved') = 'pending'"
                + users_filter,
                users_params,
            ),
        },
        "system": {
            "version": app_info.get("version", ""),
            "uptime_seconds": int(app_info.get("uptime_seconds", 0)),
            "db_ok": db_ok,
            "db_latency_ms": latency_ms,
            "pool": get_pool_status(),
            "redis": _redis_state(),
        },
        "recent_errors": recent,
    }


@router.get("/meta")
def admin_meta(
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    """下拉选项：角色 / 部门（用户管理表单用）."""
    roles = [
        {"code": r.code, "name": r.name, "is_system": bool(r.is_system)}
        for r in db.query(Role).order_by(Role.sort_order.desc(), Role.id.asc()).all()
    ]
    own_dept = _actor_department(db, current_user)
    scope = _scope(db, current_user)
    scope_ids = _scope_dept_ids(db, current_user)
    try:
        base = (
            "SELECT id, username, department_id FROM users "
            "WHERE is_active AND COALESCE(approval_status, 'approved') = 'approved' "
        )
        if scope_ids is None:
            rows = db.execute(text(base + "ORDER BY id")).fetchall()
        elif scope_ids:
            placeholders = ", ".join(f":d{i}" for i in range(len(scope_ids)))
            rows = db.execute(
                text(base + f"AND department_id IN ({placeholders}) ORDER BY id"),
                {f"d{i}": d for i, d in enumerate(scope_ids)},
            ).fetchall()
        else:
            rows = db.execute(
                text(base + "AND id = :self_id ORDER BY id"), {"self_id": current_user.id}
            ).fetchall()
        candidates = [
            {"id": int(r[0]), "username": r[1], "department_id": r[2]} for r in rows
        ]
    except Exception:
        candidates = []
    departments = _list_departments(db)
    if scope_ids is not None:
        allowed = set(scope_ids) if scope_ids else {int(current_user.department_id or 0)}
        departments = [d for d in departments if d["id"] in allowed]
    return {
        "scope": scope,
        "data_scope": data_scope(db, current_user),
        "own_department_id": own_dept,
        "roles": roles,
        "departments": departments,
        "users": candidates,
    }

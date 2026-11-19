# routers/bi_admin.py — 权限管理 + 操作审计 独立路由
"""看板权限、操作审计日志"""

from app.timezone import time_text
import json
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.middleware.audit import log_audit

router = APIRouter(tags=["BI管理"])


@router.put("/dashboards/{dashboard_id}/permissions")
def update_dashboard_permissions(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新看板权限"""
    perms = payload.get("permissions", [])
    is_public = payload.get("is_public", False)
    db.execute(text("""
        UPDATE bi_dashboards SET permissions = CAST(:p AS jsonb), is_public = :pub
        WHERE id = :id AND owner_id = :uid
    """), {"p": json.dumps(perms), "pub": is_public, "id": dashboard_id, "uid": current_user.id})
    db.commit()
    log_audit(current_user.id, "permission.update", "dashboard", dashboard_id,
              {"permissions": perms, "is_public": is_public})
    return {"message": "权限已更新"}


@router.get("/dashboards/{dashboard_id}/permissions")
def get_dashboard_permissions(
    dashboard_id: int,
    db: Session = Depends(get_db),
):
    """获取看板权限"""
    row = db.execute(text(
        "SELECT permissions, is_public, owner_id FROM bi_dashboards WHERE id = :id"
    ), {"id": dashboard_id}).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    return {"permissions": row[0] or [], "is_public": row[1] or False, "owner_id": row[2]}


@router.get("/audit-logs")
def get_audit_logs(
    resource_type: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取操作审计日志"""
    where = ""
    params = {"uid": current_user.id, "limit": limit, "offset": offset}
    if resource_type:
        where = "AND resource_type = :rtype"
        params["rtype"] = resource_type
    rows = db.execute(text(f"""
        SELECT id, user_id, action, resource_type, resource_id, detail, ip, created_at
        FROM bi_audit_logs WHERE user_id = :uid {where}
        ORDER BY created_at DESC LIMIT :limit OFFSET :offset
    """), params).fetchall()
    return {
        "logs": [{"id": r[0], "user_id": r[1], "action": r[2], "resource_type": r[3],
                   "resource_id": r[4], "detail": r[5], "ip": r[6], "created_at": time_text(r[7])}
                  for r in rows]
    }
